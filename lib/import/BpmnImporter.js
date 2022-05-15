import { is } from '../util/ModelUtil';

import {
  isExpanded
} from '../util/DiUtil';

import {
  elementToString,
  elementData,
  getWaypoints,
  getDiagramsToImport,
  isFrameElement,
  isPointInsideBBox,
  addLabel,
  getSource,
  getTarget,
  attachBoundary
} from './Util';

import {
  forEach
} from 'min-dash';

import BpmnTreeWalker from './BpmnTreeWalker';

var handlers = {
  'bpmndi:BPMNPlane': function(semantic, di, parent, service) {
    var attrs = is(semantic, 'bpmn:SubProcess') ? { id: semantic.id + '_plane' } : {};
    var element = service._elementFactory.createRoot(elementData(semantic, di, attrs));
    service._canvas.addRootElement(element);
    return element;
  },
  'bpmndi:BPMNShape': function(semantic, di, parent, service) {
    var collapsed = !isExpanded(semantic, di);
    var isFrame = isFrameElement(semantic);
    var hidden = parent && (parent.hidden || parent.collapsed);
    var bounds = di.bounds;
    var parentIndex;
    var element = service._elementFactory.createShape(elementData(semantic, di, {
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
      if (!isPointInsideBBox(parent, bounds)) {
        parent = service._canvas.findRoot(parent);
      }
    }
    service._canvas.addShape(element, parent, parentIndex);

    return element;
  },
  'bpmndi:BPMNEdge': function(semantic, di, parent, service) {
    var source = getSource(semantic, service);
    var target = getTarget(semantic, service);
    var hidden = parent && (parent.hidden || parent.collapsed);
    var parentIndex;
    var element = service._elementFactory.createConnection(elementData(semantic, di, {
      hidden: hidden,
      source: source,
      target: target,
      waypoints: getWaypoints(di, source, target)
    }));

    if (is(semantic, 'bpmn:DataAssociation')) {
      parent = service._canvas.findRoot(parent);
    }
    if (is(semantic, 'bpmn:SequenceFlow')) {
      parentIndex = 0;
    }

    service._canvas.addConnection(element, parent, parentIndex);

    return element;
  }
};

function add(semantic, di, parentElement, service) {
  var element;

  var valid = false;
  for (const key in handlers) {
    if (is(di, key)) {
      element = handlers[key](semantic, di, parentElement, service);
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