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

import {
  getLabel
} from '../features/label-editing/LabelUtil';

import {
  isLabelExternal,
  getExternalLabelBounds
} from '../util/LabelUtil';

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

function notYetDrawn(translate, semantic, refSemantic, property) {
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

export function addLabel(semantic, di, element, service) {
  if (!isLabelExternal(semantic) || !getLabel(element)) {
    return;
  }

  var bounds,
      text,
      label;

  bounds = getExternalLabelBounds(di, element);

  text = getLabel(element);

  if (text) {
    bounds = service._textRenderer.getExternalLabelBounds(bounds, text);
  }

  label = service._elementFactory.createLabel(elementData(semantic, di, {
    id: semantic.id + '_label',
    labelTarget: element,
    type: 'label',
    hidden: element.hidden || !getLabel(element),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }));

  return service._canvas.addShape(label, element.parent);
}

export function attachBoundary(boundarySemantic, boundaryElement, service) {
  var hostSemantic = boundarySemantic.attachedToRef;

  if (!hostSemantic) {
    throw new Error(service._translate('missing {semantic}#attachedToRef', {
      semantic: elementToString(boundarySemantic)
    }));
  }

  var host = service._elementRegistry.get(hostSemantic.id),
      attachers = host && host.attachers;

  if (!host) {
    throw notYetDrawn(service._translate, boundarySemantic, hostSemantic, 'attachedToRef');
  }

  boundaryElement.host = host;

  if (!attachers) {
    host.attachers = attachers = [];
  }

  if (attachers.indexOf(boundaryElement) === -1) {
    attachers.push(boundaryElement);
  }
}

export function getSource(semantic, service) {
  var side = 'source';
  var element,
      refSemantic,
      type = semantic.$type;

  refSemantic = semantic[side + 'Ref'];

  if (side === 'source' && type === 'bpmn:DataInputAssociation') {
    refSemantic = refSemantic && refSemantic[0];
  }

  if (side === 'source' && type === 'bpmn:DataOutputAssociation' ||
      side === 'target' && type === 'bpmn:DataInputAssociation') {
    refSemantic = semantic.$parent;
  }

  element = refSemantic && service._elementRegistry.get(refSemantic.id);

  if (element) {
    return element;
  }

  if (refSemantic) {
    throw notYetDrawn(service._translate, semantic, refSemantic, side + 'Ref');
  } else {
    throw new Error(service._translate('{semantic}#{side} Ref not specified', {
      semantic: elementToString(semantic),
      side: side
    }));
  }
}

export function getTarget(semantic, service) {
  var side = 'target';
  var element,
      refSemantic,
      type = semantic.$type;

  refSemantic = semantic[side + 'Ref'];

  if (side === 'source' && type === 'bpmn:DataInputAssociation') {
    refSemantic = refSemantic && refSemantic[0];
  }

  if (side === 'source' && type === 'bpmn:DataOutputAssociation' ||
      side === 'target' && type === 'bpmn:DataInputAssociation') {
    refSemantic = semantic.$parent;
  }

  element = refSemantic && service._elementRegistry.get(refSemantic.id);

  if (element) {
    return element;
  }

  if (refSemantic) {
    throw notYetDrawn(service._translate, semantic, refSemantic, side + 'Ref');
  } else {
    throw new Error(service._translate('{semantic}#{side} Ref not specified', {
      semantic: elementToString(semantic),
      side: side
    }));
  }
}