import {
  assign
} from 'min-dash';

import {
  getMid
} from 'diagram-js/lib/layout/LayoutUtil';

import {
  find,
  forEach,
  map
} from 'min-dash';

export function elementToString(e) {
  if (!e) {
    return '<null>';
  }

  return '<' + e.$type + (e.id ? ' id="' + e.id : '') + '" />';
}

export function contextual(fn, ctx) {
  return function(e) {
    fn(e, ctx);
  };
}

export function is(element, type) {
  return element.$instanceOf(type);
}

export function findDisplayCandidate(definitions) {
  return find(definitions.rootElements, function(e) {
    return is(e, 'bpmn:Process') || is(e, 'bpmn:Collaboration');
  });
}

export function elementData(semantic, di, attrs) {
  return assign({
    id: semantic.id,
    type: semantic.$type,
    businessObject: semantic,
    di: di
  }, attrs);
}

export function getWaypoints(di, source, target) {

  var waypoints = di.waypoint;

  if (!waypoints || waypoints.length < 2) {
    return [ getMid(source), getMid(target) ];
  }

  return waypoints.map(function(p) {
    return { x: p.x, y: p.y };
  });
}

export function notYetDrawn(translate, semantic, refSemantic, property) {
  return new Error(translate('element {element} referenced by {referenced}#{property} not yet drawn', {
    element: elementToString(refSemantic),
    referenced: elementToString(semantic),
    property: property
  }));
}

export function getDiagramsToImport(definitions, bpmnDiagram) {
  if (!bpmnDiagram) {
    return;
  }

  var bpmnElement = bpmnDiagram.plane.bpmnElement,
      rootElement = bpmnElement;

  if (!is(bpmnElement, 'bpmn:Process') && !is(bpmnElement, 'bpmn:Collaboration')) {
    rootElement = findRootProcess(bpmnElement);
  }

  // in case the process is part of a collaboration, the plane references the
  // collaboration, not the process
  var collaboration;

  if (is(rootElement, 'bpmn:Collaboration')) {
    collaboration = rootElement;
  } else {
    collaboration = find(definitions.rootElements, function(element) {
      if (!is(element, 'bpmn:Collaboration')) {
        return;
      }

      return find(element.participants, function(participant) {
        return participant.processRef === rootElement;
      });
    });
  }

  var rootElements = [ rootElement ];

  // all collaboration processes can contain sub-diagrams
  if (collaboration) {
    rootElements = map(collaboration.participants, function(participant) {
      return participant.processRef;
    });

    rootElements.push(collaboration);
  }

  var allChildren = selfAndAllFlowElements(rootElements);

  // if we have multiple diagrams referencing the same element, we
  // use the first in the file
  var diagramsToImport = [ bpmnDiagram ];
  var handledElements = [ bpmnElement ];

  forEach(definitions.diagrams, function(diagram) {
    var businessObject = diagram.plane.bpmnElement;

    if (
      allChildren.indexOf(businessObject) !== -1 &&
      handledElements.indexOf(businessObject) === -1
    ) {
      diagramsToImport.push(diagram);
      handledElements.push(businessObject);
    }
  });


  return diagramsToImport;
}

export function selfAndAllFlowElements(elements) {
  var result = [];

  forEach(elements, function(element) {
    if (!element) {
      return;
    }

    result.push(element);

    result = result.concat(selfAndAllFlowElements(element.flowElements));
  });

  return result;
}

export function findRootProcess(element) {
  var parent = element;

  while (parent) {
    if (is(parent, 'bpmn:Process')) {
      return parent;
    }

    parent = parent.$parent;
  }
}

export function isPointInsideBBox(bbox, point) {
  point = getMid(point);
  var x = point.x,
      y = point.y;

  return x >= bbox.x &&
    x <= bbox.x + bbox.width &&
    y >= bbox.y &&
    y <= bbox.y + bbox.height;
}

export function isFrameElement(semantic) {
  return is(semantic, 'bpmn:Group');
}