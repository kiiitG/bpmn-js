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


/**
 * Returns true if an element has the given meta-model type
 *
 * @param  {ModdleElement}  element
 * @param  {string}         type
 *
 * @return {boolean}
 */
function is(element, type) {
  return element.$instanceOf(type);
}


/**
 * Find a suitable display candidate for definitions where the DI does not
 * correctly specify one.
 */
function findDisplayCandidate(definitions) {
  return find(definitions.rootElements, function(e) {
    return is(e, 'bpmn:Process') || is(e, 'bpmn:Collaboration');
  });
}


export default function BpmnTreeWalker(handler, translate) {

  // list of containers already walked
  var handledElements = {};

  // list of elements to handle deferred to ensure
  // prerequisites are drawn
  var deferred = [];

  var diMap = {};

  // Helpers //////////////////////

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

  // function visit(element, ctx) {
  //   if (element.gfx) {
  //     throw new Error(
  //       translate('already rendered {element}', { element: elementToString(element) })
  //     );
  //   }
  //   return handler.element(element, diMap[element.id], ctx);
  // }

  // function visitRoot(element, diagram) {
  //   return handler.root(element, diMap[element.id], diagram);
  // }

  function visitIfDi(element, ctx) {
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

  // DI handling //////////////////////

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

    // var isSubProcess = is(element, 'bpmn:SubProcess');
    // var isFlowNode = is(element, 'bpmn:FlowNode');
    // var isActivity = is(element, 'bpmn:Activity');
    // if (isSubProcess || isFlowNode || isActivity) {
    //   console.log('isSubProcess = ' + is(element, 'bpmn:SubProcess') + ', isFlowNode = ' +
    //   is(element, 'bpmn:FlowNode') + ', isActivity = ' + is(element, 'bpmn:Activity'));
    // }

    var valid = false;
    for (const key in handlers) {
      if (is(element, key)) {
        handlers[key](element, plane, definitions);
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
    'bpmn:Process': function(element, parent, definitions) {
      var context = visitIfDi(element, parent);

      forEach(element.flowElements, function(e) {
        registerDi1(e, context);
      });
      handleLaneSets(element.laneSets, context);
      if (element.ioSpecification) {
        forEach(element.ioSpecification.dataInputs, contextual(handleDataInput, context));
        forEach(element.ioSpecification.dataOutputs, contextual(handleDataOutput, context));
      }
      forEach(element.artifacts, function(e) {
        registerDi1(e, context);
      });
    },
    'bpmn:SubProcess': function(element, parent, definitions) {
      var context = visitIfDi(element, parent);

      forEach(element.flowElements, function(e) {
        registerDi1(e, context);
      });
      handleLaneSets(element.laneSets, context);
      forEach(element.artifacts, function(e) {
        registerDi1(e, context);
      });
    },
    'bpmn:Collaboration': function(element, parent, definitions) {
      var context = visitIfDi(element, parent);

      forEach(element.participants, contextual(handleParticipant, context));
      forEach(element.artifacts, function(e) {
        registerDi1(e, context);
      });
      deferred.push(function() {
        forEach(element.messageFlows, contextual(handleMessageFlow, context));
      });
      var processes = filter(definitions.rootElements, function(e) {
        return !isHandled(e) && is(e, 'bpmn:Process') && e.laneSets;
      });
      processes.forEach(contextual(handleProcess, context));
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

    // drain deferred until empty
    while (deferred.length) {
      fn = deferred.shift();

      fn();
    }
  }

  function handleProcess(process, context) {
    handleFlowElementsContainer(process, context);
    handleIoSpecification(process.ioSpecification, context);

    handleArtifacts(process.artifacts, context);

    // log process handled
    handled(process);
  }

  function handleFlowElementsContainer(container, context) {
    forEach(container.flowElements, function(e) {
      registerDi1(e, context);
    });

    handleLaneSets(container.laneSets, context);
  }

  var handlers1 = {
    'bpmn:SequenceFlow': function(e, context) {
      deferred.push(function() {
        visitIfDi(e, context);
      });
    },
    'bpmn:BoundaryEvent': function(e, parent) {
      deferred.unshift(function() {
        var context = visitIfDi(e, parent);

        forEach(e.flowElements, function(fe) {
          registerDi1(fe, context || parent);
        });

        handleLaneSets(e.laneSets, context || parent);

        forEach(e.artifacts, function(a) {
          registerDi1(a, context || parent);
        });

        if (e.ioSpecification) {
          forEach(e.ioSpecification.dataInputs, contextual(handleDataInput, parent));
          forEach(e.ioSpecification.dataOutputs, contextual(handleDataOutput, parent));
        }

        deferred.push(function() {
          forEach(e.dataInputAssociations, contextual(handleDataAssociation, parent));
          forEach(e.dataOutputAssociations, contextual(handleDataAssociation, parent));
        });
      });
    },
    'bpmn:FlowNode': function(e, parent) {

      // function handleFlowNode(flowNode, context) {
      //   var childCtx = visitIfDi(flowNode, context);
      //   handleSubProcess(flowNode, childCtx || context);
      //   handleIoSpecification(flowNode.ioSpecification, context);
      //   deferred.push(function() {
      //     forEach(flowNode.dataInputAssociations, contextual(handleDataAssociation, context));
      //     forEach(flowNode.dataOutputAssociations, contextual(handleDataAssociation, context));
      //   });
      // }
      var context = visitIfDi(e, parent);

      forEach(e.flowElements, function(fe) {
        registerDi1(fe, context || parent);
      });

      handleLaneSets(e.laneSets, context || parent);

      forEach(e.artifacts, function(a) {
        registerDi1(a, context || parent);
      });

      if (e.ioSpecification) {
        forEach(e.ioSpecification.dataInputs, contextual(handleDataInput, parent));
        forEach(e.ioSpecification.dataOutputs, contextual(handleDataOutput, parent));
      }

      deferred.push(function() {
        forEach(e.dataInputAssociations, contextual(handleDataAssociation, parent));
        forEach(e.dataOutputAssociations, contextual(handleDataAssociation, parent));
      });
    },
    'bpmn:DataObject': function(e, context) {
    },
    'bpmn:DataStoreReference': function(e, context) {
      visitIfDi(e, context);
    },
    'bpmn:DataObjectReference': function(e, context) {
      visitIfDi(e, context);
    },
    'bpmn:Association': function(e, context) {
      deferred.push(function() {
        visitIfDi(e, context);
      });
    },
    'bpmn:Group': function(e, context) {
      visitIfDi(e, context);
    },
    'bpmn:TextAnnotation': function(e, context) {
      visitIfDi(e, context);
    }
  };

  function registerDi1(e, context) {
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

  function handleMessageFlow(messageFlow, context) {
    visitIfDi(messageFlow, context);
  }

  function handleDataAssociation(association, context) {
    visitIfDi(association, context);
  }

  function handleDataInput(dataInput, context) {
    visitIfDi(dataInput, context);
  }

  function handleDataOutput(dataOutput, context) {
    visitIfDi(dataOutput, context);
  }

  function handleArtifacts(artifacts, context) {
    forEach(artifacts, function(e) {
      registerDi1(e, context);
    });
  }

  function handleIoSpecification(ioSpecification, context) {
    if (!ioSpecification) {
      return;
    }

    forEach(ioSpecification.dataInputs, contextual(handleDataInput, context));
    forEach(ioSpecification.dataOutputs, contextual(handleDataOutput, context));
  }

  function handleSubProcess(subProcess, context) {
    handleFlowElementsContainer(subProcess, context);
    handleArtifacts(subProcess.artifacts, context);
  }

  function handleLane(lane, context) {

    deferred.push(function() {

      var newContext = visitIfDi(lane, context);

      if (lane.childLaneSet) {
        handleLaneSet(lane.childLaneSet, newContext || context);
      }

      wireFlowNodeRefs(lane);
    });
  }

  function handleLaneSet(laneSet, context) {
    forEach(laneSet.lanes, contextual(handleLane, context));
  }

  function handleLaneSets(laneSets, context) {
    forEach(laneSets, contextual(handleLaneSet, context));
  }

  function handleParticipant(participant, context) {
    var newCtx = visitIfDi(participant, context);

    var process = participant.processRef;
    if (process) {
      handleProcess(process, newCtx || context);
    }
  }

  function wireFlowNodeRefs(lane) {

    // wire the virtual flowNodeRefs <-> relationship
    forEach(lane.flowNodeRef, function(flowNode) {
      var lanes = flowNode.get('lanes');

      if (lanes) {
        lanes.push(lane);
      }
    });
  }

  // API //////////////////////

  return {
    handleDeferred: handleDeferred,
    handleDefinitions: handleDefinitions,
    handleSubProcess: handleSubProcess,
    registerDi: registerDi
  };
}