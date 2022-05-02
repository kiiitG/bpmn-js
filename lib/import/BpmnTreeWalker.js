import {
  filter,
  find,
  forEach
} from 'min-dash';

import {
  elementToString
} from './Util';

import {
  ensureCompatDiRef
} from '../util/CompatibilityUtil';

function is(element, type) {
  return element.$instanceOf(type);
}

function findDisplayCandidate(definitions) {
  return find(definitions.rootElements, function(e) {
    return is(e, 'bpmn:Process') || is(e, 'bpmn:Collaboration');
  });
}

export default function BpmnTreeWalker(handler, translate) {
  var handledElements = {};
  var deferred = [];
  var diMap = {};

  function contextual(fn, ctx) {
    return function(e) {
      fn(e, ctx);
    };
  }

  function handled(element) {
    handledElements[element.id] = element;
  }

  function isHandled(element) {
    return handledElements[element.id];
  }

  function visit(element, ctx) {
    try {
      if (element.gfx) {
        throw new Error(
          translate('already rendered {element}', { element: elementToString(element) })
        );
      }
      var gfx = diMap[element.id] && handler.element(element, diMap[element.id], ctx);

      handled(element);

      return gfx;
    } catch (e) {
      logError(e.message, { element: element, error: e });

      console.error(translate('failed to import {element}', { element: elementToString(element) }));
      console.error(e);
    }
  }

  function logError(message, context) {
    handler.error(message, context);
  }

  function registerDi(di) {
    var bpmnElement = di.bpmnElement;

    if (bpmnElement) {
      if (diMap[bpmnElement.id]) {
        logError(
          translate('multiple DI elements defined for {element}', {
            element: elementToString(bpmnElement)
          }),
          { element: bpmnElement }
        );
      } else {
        diMap[bpmnElement.id] = di;

        ensureCompatDiRef(bpmnElement);
      }
    } else {
      logError(
        translate('no bpmnElement referenced in {element}', {
          element: elementToString(di)
        }),
        { element: di }
      );
    }
  }

  function handleDi(diagram) {
    var plane = diagram.plane;
    registerDi(plane);
    forEach(plane.planeElement, registerDi);
  }

  function validate(definitions, diagram) {
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
      } else {
        logError(
          translate('correcting missing bpmnElement on {plane} to {rootElement}', {
            plane: elementToString(diagram.plane),
            rootElement: elementToString(rootElement)
          })
        );
        diagram.plane.bpmnElement = rootElement;
        registerDi(diagram.plane);
      }
    }
    return rootElement;
  }

  function registerSemantic(element, definitions, plane) {
    var context = visit(element, plane);
    var valid = false;
    for (const key in handlers) {
      if (is(element, key)) {
        handlers[key](element, context, plane, definitions);
        valid = true;
        break;
      }
    }
    if (!valid) {
      throw new Error(
        translate('unsupported bpmnElement for {plane}: {rootElement}', {
          plane: elementToString(plane),
          rootElement: elementToString(element)
        }));
    }
  }

  var handlers = {
    'bpmn:Process': function(element, context, parent, definitions) {
      forEach(element.flowElements, function(e) {
        registerSemantic1(e, context);
      });
      handleLaneSets(element.laneSets, context);
      if (element.ioSpecification) {
        forEach(element.ioSpecification.dataInputs, contextual(visit, context));
        forEach(element.ioSpecification.dataOutputs, contextual(visit, context));
      }
      forEach(element.artifacts, function(e) {
        registerSemantic1(e, context);
      });
    },
    'bpmn:SubProcess': function(element, context, parent, definitions) {
      forEach(element.flowElements, function(e) {
        registerSemantic1(e, context);
      });
      handleLaneSets(element.laneSets, context);
      forEach(element.artifacts, function(e) {
        registerSemantic1(e, context);
      });
    },
    'bpmn:Collaboration': function(element, context, parent, definitions) {
      forEach(element.participants, contextual(registerSemantic1, context));
      forEach(element.artifacts, function(e) {
        registerSemantic1(e, context);
      });
      deferred.push(function() {
        forEach(element.messageFlows, contextual(visit, context));
      });
      var processes = filter(definitions.rootElements, function(e) {
        return !isHandled(e) && is(e, 'bpmn:Process') && e.laneSets;
      });
      processes.forEach(contextual(registerSemantic, context));
    }
  };

  function handleSemantic(definitions, diagram) {
    var plane = diagram.plane;
    var rootElement = getRoot(definitions, diagram);
    registerSemantic(rootElement, definitions, plane);
  }

  function handleDefinitions(definitions, diagram) {
    validate(definitions, diagram);
    diMap = {};
    handleDi(diagram);
    handleSemantic(definitions, diagram);
    handleDeferred(deferred);
  }

  function handleDeferred() {
    var fn;
    while (deferred.length) {
      fn = deferred.shift();
      fn();
    }
  }

  function handleProcess(process, context) {
    handleFlowElementsContainer(process, context);
    handleIoSpecification(process.ioSpecification, context);
    handleArtifacts(process.artifacts, context);
    handled(process);
  }

  function handleFlowElementsContainer(container, context) {
    forEach(container.flowElements, function(e) {
      registerSemantic1(e, context);
    });

    handleLaneSets(container.laneSets, context);
  }

  function handleArtifacts(artifacts, context) {
    forEach(artifacts, function(e) {
      registerSemantic1(e, context);
    });
  }

  function handleIoSpecification(ioSpecification, context) {
    if (!ioSpecification) {
      return;
    }

    forEach(ioSpecification.dataInputs, contextual(visit, context));
    forEach(ioSpecification.dataOutputs, contextual(visit, context));
  }

  function handleSubProcess(subProcess, context) {
    handleFlowElementsContainer(subProcess, context);
    handleArtifacts(subProcess.artifacts, context);
  }

  var handlers1 = {
    'bpmn:SequenceFlow': function(e, context) {
      deferred.push(function() {
        visit(e, context);
      });
    },
    'bpmn:BoundaryEvent': function(e, parent) {
      deferred.unshift(function() {
        var context = visit(e, parent);

        forEach(e.flowElements, function(fe) {
          registerSemantic1(fe, context || parent);
        });

        handleLaneSets(e.laneSets, context || parent);

        forEach(e.artifacts, function(a) {
          registerSemantic1(a, context || parent);
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
        registerSemantic1(fe, context || parent);
      });

      handleLaneSets(e.laneSets, context || parent);

      forEach(e.artifacts, function(a) {
        registerSemantic1(a, context || parent);
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
        handleProcess(process, context || parent);
      }
    }
  };

  function registerSemantic1(e, context) {
    var valid = false;
    for (const key in handlers1) {
      if (is(e, key)) {
        handlers1[key](e, context);
        valid = true;
        break;
      }
    }
    if (!valid) {
      throw new Error(
        translate('unsupported bpmnElement for {rootElement}', {
          rootElement: elementToString(e)
        }));
    }
  }

  function handleLane(lane, context) {

    deferred.push(function() {

      var newContext = visit(lane, context);

      if (lane.childLaneSet) {
        handleLaneSet(lane.childLaneSet, newContext || context);
      }

      wireFlowNodeRefs(lane);
    });
  }

  function wireFlowNodeRefs(lane) {
    forEach(lane.flowNodeRef, function(flowNode) {
      var lanes = flowNode.get('lanes');

      if (lanes) {
        lanes.push(lane);
      }
    });
  }

  function handleLaneSet(laneSet, context) {
    forEach(laneSet.lanes, contextual(handleLane, context));
  }

  function handleLaneSets(laneSets, context) {
    forEach(laneSets, contextual(handleLaneSet, context));
  }

  // function handleParticipant(participant, context) {
  //   var newCtx = visit(participant, context);

  //   var process = participant.processRef;
  //   if (process) {
  //     handleProcess(process, newCtx || context);
  //   }
  // }

  return {
    handleDeferred: handleDeferred,
    handleDefinitions: handleDefinitions,
    handleSubProcess: handleSubProcess,
    registerDi: registerDi
  };
}