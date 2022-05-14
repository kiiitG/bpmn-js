
/**
 * Import the definitions into a diagram.
 *
 * Errors and warnings are reported through the specified callback.
 *
 * @param  {djs.Diagram} service
 * @param  {ModdleElement<Definitions>} definitions
 * @param  {ModdleElement<BPMNDiagram>} [bpmnDiagram] the diagram to be rendered
 * (if not provided, the first one will be rendered)
 *
 * Returns {Promise<ImportBPMNDiagramResult, ImportBPMNDiagramError>}
 */
export function importBpmnDiagram(service, definitions, bpmnDiagram) {
  var error, warnings = [];

  return new Promise(function(resolve, reject) {
    try {
      var importer = service.get('bpmnImporter');
      var eventBus = service.get('eventBus');

      eventBus.fire('import.render.start', { definitions: definitions });

      bpmnDiagram = bpmnDiagram || (definitions.diagrams && definitions.diagrams[0]);
      importer.importBpmnDiagram(service, definitions, bpmnDiagram, warnings);

      eventBus.fire('import.render.complete', {
        error: error,
        warnings: warnings
      });

      return resolve({ warnings: warnings });
    } catch (e) {
      e.warnings = warnings;
      return reject(e);
    }
  });
}