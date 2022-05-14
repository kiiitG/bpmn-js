import {
  filter,
  forEach
} from 'min-dash';

import {
  elementToString,
  contextual,
  is,
  findDisplayCandidate
} from './Util';

import {
  ensureCompatDiRef
} from '../util/CompatibilityUtil';

export default function BpmnTreeWalker(handler, translate) {
  var handledElements = {};
  var deferred = [];
  var diMap = {};

  function validateDiagram(definitions, diagram) {
    var diagrams = definitions.diagrams;
    if (diagram && diagrams.indexOf(diagram) === -1) {
      throw new Error(translate('diagram not part of bpmn:Definitions'));
    }
    if (!diagram && diagrams && diagrams.length) {
      diagram = diagrams[0];
    }
    if (!diagram) {
      throw new Error(translate('no diagram to display'));
    }
    var plane = diagram.plane;
    if (!plane) {
      throw new Error(translate(
        'no plane for {element}',
        { element: elementToString(diagram) }
      ));
    }
  }

  function getRoot(definitions, diagram) {
    var rootElement = diagram.plane.bpmnElement;
    if (!rootElement) {
      rootElement = findDisplayCandidate(definitions);
      if (!rootElement) {
        throw new Error(translate('no process or collaboration to display'));
      }
      handler.error(
        translate('correcting missing bpmnElement on {plane} to {rootElement}', {
          plane: elementToString(diagram.plane),
          rootElement: elementToString(rootElement)
        })
      );
      diagram.plane.bpmnElement = rootElement;
      registerDi(diagram.plane);
    }
    return rootElement;
  }

  function visit(element, context) {
    if (element.gfx) {
      handler.error('already rendered {element}' + elementToString(element), context);
      return;
    }
    try {
      var gfx = diMap[element.id] && handler.element(element, diMap[element.id], context);
      handledElements[element.id] = element;
    } catch (e) {
      handler.error(e.message, { element: element, error: e });
    }

    return gfx;
  }

  function validateDi(bpmnElement) {
    return bpmnElement && !diMap[bpmnElement];
  }

  function registerDi(di) {
    var bpmnElement = di.bpmnElement;
    if (!validateDi(bpmnElement)) {
      handler.error(
        translate('error in handling di for {element}', {
          element: elementToString(bpmnElement)
        }),
        { element: bpmnElement }
      );
      return;
    }
    diMap[bpmnElement.id] = di;
    ensureCompatDiRef(bpmnElement);
  }

  function registerSemantic(element, parent, handlers, definitions) {
    var valid = false;
    for (const key in handlers) {
      if (is(element, key)) {
        handlers[key](element, parent, definitions);
        valid = true;
        break;
      }
    }
    if (!valid) {
      throw new Error(
        translate('unsupported bpmnElement for {element}', {
          element: elementToString(element)
        }));
    }
  }

  function registerRoot(element, parent, definitions) {
    registerSemantic(element, parent, roots, definitions);
  }

  function registerElement(element, parent) {
    registerSemantic(element, parent, elements);
  }

  var roots = {
    'bpmn:Process': function(element, parent, definitions) {
      var context = visit(element, parent);
      forEach(element.flowElements, function(e) {
        registerElement(e, context);
      });
      forEach(element.laneSets, contextual(registerElement, context));
      if (element.ioSpecification) {
        forEach(element.ioSpecification.dataInputs, contextual(visit, context));
        forEach(element.ioSpecification.dataOutputs, contextual(visit, context));
      }
      forEach(element.artifacts, function(e) {
        registerElement(e, context);
      });
    },
    'bpmn:SubProcess': function(element, parent, definitions) {
      var context = visit(element, parent);
      forEach(element.flowElements, function(e) {
        registerElement(e, context);
      });
      forEach(element.laneSets, contextual(registerElement, context));
      forEach(element.artifacts, function(e) {
        registerElement(e, context);
      });
    },
    'bpmn:Collaboration': function(element, parent, definitions) {
      var context = visit(element, parent);
      forEach(element.participants, contextual(registerElement, context));
      forEach(element.artifacts, function(e) {
        registerElement(e, context);
      });
      deferred.push(function() {
        forEach(element.messageFlows, contextual(visit, context));
      });
      var processes = filter(definitions.rootElements, function(e) {
        return !handledElements[e.id] && is(e, 'bpmn:Process') && e.laneSets;
      });
      processes.forEach(contextual(registerRoot, context));
    }
  };

  var elements = {
    'bpmn:SequenceFlow': function(e, context) {
      deferred.push(function() {
        visit(e, context);
      });
    },
    'bpmn:BoundaryEvent': function(e, parent) {
      deferred.unshift(function() {
        var context = visit(e, parent);

        forEach(e.flowElements, function(fe) {
          registerElement(fe, context || parent);
        });

        forEach(e.laneSets, contextual(registerElement, context));

        forEach(e.artifacts, function(a) {
          registerElement(a, context || parent);
        });

        if (e.ioSpecification) {
          forEach(e.ioSpecification.dataInputs, contextual(visit, parent));
          forEach(e.ioSpecification.dataOutputs, contextual(visit, parent));
        }

        deferred.push(function() {
          forEach(e.dataInputAssociations, contextual(visit, parent));
          forEach(e.dataOutputAssociations, contextual(visit, parent));
        });
      });
    },
    'bpmn:FlowNode': function(e, parent) {
      var context = visit(e, parent);

      forEach(e.flowElements, function(fe) {
        registerElement(fe, context || parent);
      });

      forEach(e.laneSets, contextual(registerElement, context));

      forEach(e.artifacts, function(a) {
        registerElement(a, context || parent);
      });

      if (e.ioSpecification) {
        forEach(e.ioSpecification.dataInputs, contextual(visit, parent));
        forEach(e.ioSpecification.dataOutputs, contextual(visit, parent));
      }

      deferred.push(function() {
        forEach(e.dataInputAssociations, contextual(visit, parent));
        forEach(e.dataOutputAssociations, contextual(visit, parent));
      });
    },
    'bpmn:DataObject': function(e, context) {
    },
    'bpmn:DataStoreReference': function(e, context) {
      visit(e, context);
    },
    'bpmn:DataObjectReference': function(e, context) {
      visit(e, context);
    },
    'bpmn:Association': function(e, context) {
      deferred.push(function() {
        visit(e, context);
      });
    },
    'bpmn:Group': function(e, context) {
      visit(e, context);
    },
    'bpmn:TextAnnotation': function(e, context) {
      visit(e, context);
    },
    'bpmn:Participant': function(e, parent) {
      var context = visit(e, parent);

      var process = e.processRef;
      if (process) {
        registerElement(process, context || parent);
      }
    },
    'bpmn:Process': function(element, context) {
      forEach(element.flowElements, function(e) {
        registerElement(e, context);
      });
      forEach(element.laneSets, contextual(registerElement, context));
      if (element.ioSpecification) {
        forEach(element.ioSpecification.dataInputs, contextual(visit, context));
        forEach(element.ioSpecification.dataOutputs, contextual(visit, context));
      }
      forEach(element.artifacts, function(e) {
        registerElement(e, context);
      });
      handledElements[element.id] = element;
    },
    'bpmn:LaneSet': function(element, parent) {
      forEach(element.lanes, contextual(registerElement, parent));
    },
    'bpmn:Lane': function(element, parent) {
      deferred.push(function() {
        var context = visit(element, parent);
        if (element.childLaneSet) {
          registerElement(element.childLaneSet, context || parent);
        }
        forEach(element.flowNodeRef, function(flowNode) {
          var lanes = flowNode.get('lanes');
          if (lanes) {
            lanes.push(element);
          }
        });
      });
    }
  };

  function handleDi(diagram) {
    var plane = diagram.plane;
    registerDi(plane);
    forEach(plane.planeElement, registerDi);
  }

  function handleSemantic(definitions, diagram) {
    var rootElement = getRoot(definitions, diagram);
    registerRoot(rootElement, diagram.plane, definitions);
  }

  function handleDeferred() {
    var fn;
    while (deferred.length) {
      fn = deferred.shift();
      fn();
    }
  }

  function handleDefinitions(definitions, diagram) {
    validateDiagram(definitions, diagram);
    diMap = {};
    handleDi(diagram);
    handleSemantic(definitions, diagram);
    handleDeferred(deferred);
  }

  return {
    handleDefinitions: handleDefinitions
  };
}