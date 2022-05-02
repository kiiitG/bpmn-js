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

  function visit(element, ctx) {

    var gfx = element.gfx;

    // avoid multiple rendering of elements
    if (gfx) {
      throw new Error(
        translate('already rendered {element}', { element: elementToString(element) })
      );
    }

    // call handler
    return handler.element(element, diMap[element.id], ctx);
  }

  // function visitRoot(element, diagram) {
  //   return handler.root(element, diMap[element.id], diagram);
  // }

  function visitIfDi(element, ctx) {

    try {
      var gfx = diMap[element.id] && visit(element, ctx);

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
      var context = visit(element, parent);

      handleFlowElementsContainer(element, context);
      handleIoSpecification(element.ioSpecification, context);
      handleArtifacts(element.artifacts, context);
      handled(element);
    },
    'bpmn:SubProcess': function(element, parent, definitions) {
      var context = visit(element, parent);
      handleFlowElementsContainer(element, context);
      handleArtifacts(element.artifacts, context);
    },
    'bpmn:Collaboration': function(element, parent, definitions) {
      var context = visit(element, parent);
      forEach(element.participants, contextual(handleParticipant, context));
      handleArtifacts(element.artifacts, context);
      deferred.push(function() {
        handleMessageFlows(element.messageFlows, context);
      });
      handleUnhandledProcesses(definitions.rootElements, context);
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
      handleFlowElement(e, context);
    });

    handleLaneSets(container.laneSets, context);
  }

  var handlers1 = {
    'bpmn:SequenceFlow': function(e, context) {
      deferred.push(function() {
        handleSequenceFlow(e, context);
      });
    },
    'bpmn:BoundaryEvent': function(e, context) {
      deferred.unshift(function() {
        handleFlowNode(e, context);
      });
    },
    'bpmn:FlowNode': function(e, context) {
      handleFlowNode(e, context);
    },
    'bpmn:DataObject': function(e, context) {

      // SKIP (assume correct referencing via DataObjectReference)
    },
    'bpmn:DataStoreReference': function(e, context) {
      handleDataElement(e, context);
    },
    'bpmn:DataObjectReference': function(e, context) {
      handleDataElement(e, context);
    },
    'bpmn:Association': function(e, context) {
      deferred.push(function() {
        handleArtifact(e, context);
      });
    },
    'bpmn:Group': function(e, context) {
      handleArtifact(e, context);
    },
    'bpmn:TextAnnotation': function(e, context) {
      handleArtifact(e, context);
    }
  };

  function handleFlowElement(e, context) {
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

  function handleUnhandledProcesses(rootElements, ctx) {

    // walk through all processes that have not yet been drawn and draw them
    // if they contain lanes with DI information.
    // we do this to pass the free-floating lane test cases in the MIWG test suite
    var processes = filter(rootElements, function(e) {
      return !isHandled(e) && is(e, 'bpmn:Process') && e.laneSets;
    });

    processes.forEach(contextual(handleProcess, ctx));
  }

  function handleMessageFlow(messageFlow, context) {
    visitIfDi(messageFlow, context);
  }

  function handleMessageFlows(messageFlows, context) {
    forEach(messageFlows, contextual(handleMessageFlow, context));
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

  function handleArtifact(artifact, context) {

    // bpmn:TextAnnotation
    // bpmn:Group
    // bpmn:Association

    visitIfDi(artifact, context);
  }

  function handleArtifacts(artifacts, context) {
    forEach(artifacts, function(e) {
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

  function handleFlowNode(flowNode, context) {
    var childCtx = visitIfDi(flowNode, context);
    handleSubProcess(flowNode, childCtx || context);
    handleIoSpecification(flowNode.ioSpecification, context);

    // if (is(flowNode, 'bpmn:SubProcess')) {
    //   handleSubProcess(flowNode, childCtx || context);
    // }

    // if (is(flowNode, 'bpmn:Activity')) {
    //   handleIoSpecification(flowNode.ioSpecification, context);
    // }

    // defer handling of associations
    // affected types:
    //
    //   * bpmn:Activity
    //   * bpmn:ThrowEvent
    //   * bpmn:CatchEvent
    //
    deferred.push(function() {
      forEach(flowNode.dataInputAssociations, contextual(handleDataAssociation, context));
      forEach(flowNode.dataOutputAssociations, contextual(handleDataAssociation, context));
    });
  }

  function handleSequenceFlow(sequenceFlow, context) {
    visitIfDi(sequenceFlow, context);
  }

  function handleDataElement(dataObject, context) {
    visitIfDi(dataObject, context);
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