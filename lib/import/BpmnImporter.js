import { is } from '../util/ModelUtil';

import {
  isLabelExternal,
  getExternalLabelBounds
} from '../util/LabelUtil';

import {
  isExpanded
} from '../util/DiUtil';

import {
  getLabel
} from '../features/label-editing/LabelUtil';

import {
  elementToString,
  elementData,
  getWaypoints,
  getDiagramsToImport,
  notYetDrawn,
  isFrameElement,
  isPointInsideBBox
} from './Util';

import {
  forEach
} from 'min-dash';

import BpmnTreeWalker from './BpmnTreeWalker';

function attachBoundary(boundarySemantic, boundaryElement, service) {
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

function getEnd(semantic, side, translate, elementRegistry) {

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

function add(semantic, di, parentElement, service) {
  var element, hidden, parentIndex;

  var handlers = {
    'bpmndi:BPMNPlane': function() {
      var attrs = is(semantic, 'bpmn:SubProcess') ? { id: semantic.id + '_plane' } : {};
      element = service._elementFactory.createRoot(elementData(semantic, di, attrs));
      service._canvas.addRootElement(element);
    },
    'bpmndi:BPMNShape': function() {
      var collapsed = !isExpanded(semantic, di);
      var isFrame = isFrameElement(semantic);
      hidden = parentElement && (parentElement.hidden || parentElement.collapsed);
      var bounds = di.bounds;
      element = service._elementFactory.createShape(elementData(semantic, di, {
        collapsed: collapsed,
        hidden: hidden,
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        isFrame: isFrame
      }));

      if (is(semantic, 'bpmn:BoundaryEvent')) {
        attachBoundary(semantic, element, service);
      }

      if (is(semantic, 'bpmn:Lane')) {
        parentIndex = 0;
      }

      if (is(semantic, 'bpmn:DataStoreReference')) {
        if (!isPointInsideBBox(parentElement, bounds)) {
          parentElement = service._canvas.findRoot(parentElement);
        }
      }

      service._canvas.addShape(element, parentElement, parentIndex);
    },
    'bpmndi:BPMNEdge': function() {
      var source = getSource(semantic, service._translate, service._elementRegistry);
      var target = getTarget(semantic, service._translate, service._elementRegistry);
      hidden = parentElement && (parentElement.hidden || parentElement.collapsed);
      element = service._elementFactory.createConnection(elementData(semantic, di, {
        hidden: hidden,
        source: source,
        target: target,
        waypoints: getWaypoints(di, source, target)
      }));

      if (is(semantic, 'bpmn:DataAssociation')) {
        parentElement = service._canvas.findRoot(parentElement);
      }
      if (is(semantic, 'bpmn:SequenceFlow')) {
        parentIndex = 0;
      }

      service._canvas.addConnection(element, parentElement, parentIndex);
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
    throw new Error(service._translate('unknown di {di} for element {semantic}', {
      di: elementToString(di),
      semantic: elementToString(semantic)
    }));
  }

  addLabel(semantic, di, element, service);
  service._eventBus.fire('bpmnElement.added', { element: element });

  return element;
}

function addLabel(semantic, di, element, service) {
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

BpmnImporter.prototype.importBpmnDiagram = function(diagram, definitions, bpmnDiagram, warnings) {

  // var translate = service.get('translate');
  // var canvas = service.get('canvas');
  // var elementFactory = service.get('elementFactory');
  // var eventBus = service.get('eventBus');
  // var elementRegistry = service.get('elementRegistry');
  // var textRenderer = this._textRenderer;
  var service = this;

  var visitor = {
    element: function(element, di, parentShape) {
      return add(element, di, parentShape, service);
    },

    error: function(message, context) {
      warnings.push({ message: message, context: context });
    }
  };

  var diagramsToImport = getDiagramsToImport(definitions, bpmnDiagram);

  if (!diagramsToImport) {
    throw new Error(service._translate('no diagram to display'));
  }

  var walker = new BpmnTreeWalker(visitor, service._translate);
  forEach(diagramsToImport, function(diagram) {
    walker.handleDefinitions(definitions, diagram);
  });

  var rootId = bpmnDiagram.plane.bpmnElement.id;
  service._canvas.setRootElement(
    service._canvas.findRoot(rootId + '_plane') || service._canvas.findRoot(rootId)
  );
};