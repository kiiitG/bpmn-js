import {
  assign
} from 'min-dash';

import { is } from '../util/ModelUtil';

import {
  isLabelExternal,
  getExternalLabelBounds
} from '../util/LabelUtil';

import {
  getMid
} from 'diagram-js/lib/layout/LayoutUtil';

import {
  isExpanded
} from '../util/DiUtil';

import {
  getLabel
} from '../features/label-editing/LabelUtil';

import {
  elementToString
} from './Util';

import {
  find,
  forEach,
  map
} from 'min-dash';

import BpmnTreeWalker from './BpmnTreeWalker';

/**
 * @param {ModdleElement} semantic
 * @param {ModdleElement} di
 * @param {Object} [attrs=null]
 *
 * @return {Object}
 */
function elementData(semantic, di, attrs) {
  return assign({
    id: semantic.id,
    type: semantic.$type,
    businessObject: semantic,
    di: di
  }, attrs);
}

function getWaypoints(di, source, target) {

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

function getDiagramsToImport(definitions, bpmnDiagram) {
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

function selfAndAllFlowElements(elements) {
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

function findRootProcess(element) {
  var parent = element;

  while (parent) {
    if (is(parent, 'bpmn:Process')) {
      return parent;
    }

    parent = parent.$parent;
  }
}

function isPointInsideBBox(bbox, point) {
  var x = point.x,
      y = point.y;

  return x >= bbox.x &&
    x <= bbox.x + bbox.width &&
    y >= bbox.y &&
    y <= bbox.y + bbox.height;
}

function isFrameElement(semantic) {
  return is(semantic, 'bpmn:Group');
}

function render(definitions, bpmnDiagram, service, warnings) {

  var translate = service.get('translate');
  var canvas = service.get('canvas');
  var elementFactory = service.get('elementFactory');
  var eventBus = service.get('eventBus');
  var importer = service.get('bpmnImporter');
  var elementRegistry = service.get('elementRegistry');

  var visitor = {
    element: function(element, di, parentShape) {
      return add(element, di, parentShape, translate, elementFactory, canvas, eventBus, importer, elementRegistry);
    },

    error: function(message, context) {
      warnings.push({ message: message, context: context });
    }
  };

  var walker = new BpmnTreeWalker(visitor, translate);


  bpmnDiagram = bpmnDiagram || (definitions.diagrams && definitions.diagrams[0]);

  var diagramsToImport = getDiagramsToImport(definitions, bpmnDiagram);

  if (!diagramsToImport) {
    throw new Error(translate('no diagram to display'));
  }

  // traverse BPMN 2.0 document model,
  // starting at definitions
  forEach(diagramsToImport, function(diagram) {
    walker.handleDefinitions(definitions, diagram);
  });

  var rootId = bpmnDiagram.plane.bpmnElement.id;

  // we do need to account for different ways we create root elements
  // each nested imported <root> do have the `_plane` suffix, while
  // the root <root> is found under the business object ID
  canvas.setRootElement(
    canvas.findRoot(rootId + '_plane') || canvas.findRoot(rootId)
  );
}

export default function BpmnImporter(
    eventBus, canvas, elementFactory,
    elementRegistry, translate, textRenderer) {
  this._eventBus = eventBus;
  this._canvas = canvas;
  this._elementFactory = elementFactory;
  this._elementRegistry = elementRegistry;
  this._translate = translate;
  this._textRenderer = textRenderer;
}

BpmnImporter.$inject = [
  'eventBus',
  'canvas',
  'elementFactory',
  'elementRegistry',
  'translate',
  'textRenderer'
];

BpmnImporter.prototype.importBpmnDiagram = function(service, definitions, bpmnDiagram, warnings) {
  render(definitions, bpmnDiagram, service, warnings);
};

function add(semantic, di, parentElement, translate, elementFactory, canvas, eventBus, importer, elementRegistry) {
  var element, hidden, parentIndex;

  var handlers = {
    'bpmndi:BPMNPlane': function() {
      var attrs = is(semantic, 'bpmn:SubProcess')
        ? { id: semantic.id + '_plane' }
        : {};

      // add a virtual element (not being drawn)
      element = elementFactory.createRoot(elementData(semantic, di, attrs));

      canvas.addRootElement(element);
    },
    'bpmndi:BPMNShape': function() {
      var collapsed = !isExpanded(semantic, di),
          isFrame = isFrameElement(semantic);

      hidden = parentElement && (parentElement.hidden || parentElement.collapsed);

      var bounds = di.bounds;

      element = elementFactory.createShape(elementData(semantic, di, {
        collapsed: collapsed,
        hidden: hidden,
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        isFrame: isFrame
      }));

      if (is(semantic, 'bpmn:BoundaryEvent')) {
        attachBoundary(semantic, element, translate, elementRegistry);
      }

      // insert lanes behind other flow nodes (cf. #727)
      if (is(semantic, 'bpmn:Lane')) {
        parentIndex = 0;
      }

      if (is(semantic, 'bpmn:DataStoreReference')) {

        // check whether data store is inside our outside of its semantic parent
        if (!isPointInsideBBox(parentElement, getMid(bounds))) {
          parentElement = canvas.findRoot(parentElement);
        }
      }

      canvas.addShape(element, parentElement, parentIndex);
    },
    'bpmndi:BPMNEdge': function() {
      var source = getSource(semantic, translate, elementRegistry),
          target = getTarget(semantic, translate, elementRegistry);

      hidden = parentElement && (parentElement.hidden || parentElement.collapsed);

      element = elementFactory.createConnection(elementData(semantic, di, {
        hidden: hidden,
        source: source,
        target: target,
        waypoints: getWaypoints(di, source, target)
      }));

      if (is(semantic, 'bpmn:DataAssociation')) {
        parentElement = canvas.findRoot(parentElement);
      }

      if (is(semantic, 'bpmn:SequenceFlow')) {
        parentIndex = 0;
      }

      canvas.addConnection(element, parentElement, parentIndex);
    }
  };

  var valid = false;
  for (const key in handlers) {
    if (is(di, key)) {
      handlers[key]();
      valid = true;
    }
  }
  if (!valid) {
    throw new Error(translate('unknown di {di} for element {semantic}', {
      di: elementToString(di),
      semantic: elementToString(semantic)
    }));
  }

  // (optional) LABEL
  if (isLabelExternal(semantic) && getLabel(element)) {
    importer.addLabel(semantic, di, element, elementFactory, canvas);
  }


  eventBus.fire('bpmnElement.added', { element: element });

  return element;
}

BpmnImporter.prototype.addLabel = function(semantic, di, element, elementFactory, canvas) {
  var bounds,
      text,
      label;

  bounds = getExternalLabelBounds(di, element);

  text = getLabel(element);

  if (text) {
    bounds = this._textRenderer.getExternalLabelBounds(bounds, text);
  }

  label = elementFactory.createLabel(elementData(semantic, di, {
    id: semantic.id + '_label',
    labelTarget: element,
    type: 'label',
    hidden: element.hidden || !getLabel(element),
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }));

  return canvas.addShape(label, element.parent);
};

function attachBoundary(boundarySemantic, boundaryElement, translate, elementRegistry) {
  var hostSemantic = boundarySemantic.attachedToRef;

  if (!hostSemantic) {
    throw new Error(translate('missing {semantic}#attachedToRef', {
      semantic: elementToString(boundarySemantic)
    }));
  }

  var host = elementRegistry.get(hostSemantic.id),
      attachers = host && host.attachers;

  if (!host) {
    throw notYetDrawn(translate, boundarySemantic, hostSemantic, 'attachedToRef');
  }

  // wire element.host <> host.attachers
  boundaryElement.host = host;

  if (!attachers) {
    host.attachers = attachers = [];
  }

  if (attachers.indexOf(boundaryElement) === -1) {
    attachers.push(boundaryElement);
  }
}

function getEnd(semantic, side, translate, elementRegistry) {

  var element,
      refSemantic,
      type = semantic.$type;

  refSemantic = semantic[side + 'Ref'];

  // handle mysterious isMany DataAssociation#sourceRef
  if (side === 'source' && type === 'bpmn:DataInputAssociation') {
    refSemantic = refSemantic && refSemantic[0];
  }

  // fix source / target for DataInputAssociation / DataOutputAssociation
  if (side === 'source' && type === 'bpmn:DataOutputAssociation' ||
      side === 'target' && type === 'bpmn:DataInputAssociation') {

    refSemantic = semantic.$parent;
  }

  element = refSemantic && getElement(refSemantic, elementRegistry);

  if (element) {
    return element;
  }

  if (refSemantic) {
    throw notYetDrawn(translate, semantic, refSemantic, side + 'Ref');
  } else {
    throw new Error(translate('{semantic}#{side} Ref not specified', {
      semantic: elementToString(semantic),
      side: side
    }));
  }
}

function getSource(semantic, translate, elementRegistry) {
  return getEnd(semantic, 'source', translate, elementRegistry);
}

function getTarget(semantic, translate, elementRegistry) {
  return getEnd(semantic, 'target', translate, elementRegistry);
}

function getElement(semantic, elementRegistry) {
  return elementRegistry.get(semantic.id);
}