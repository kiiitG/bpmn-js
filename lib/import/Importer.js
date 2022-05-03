
/**
 * The importBpmnDiagram result.
 *
 * @typedef {Object} ImportBPMNDiagramResult
 *
 * @property {Array<string>} warnings
 */

/**
* The importBpmnDiagram error.
*
* @typedef {Error} ImportBPMNDiagramError
*
* @property {Array<string>} warnings
*/

/**
 * Import the definitions into a diagram.
 *
 * Errors and warnings are reported through the specified callback.
 *
 * @param  {djs.Diagram} diagram
 * @param  {ModdleElement<Definitions>} definitions
 * @param  {ModdleElement<BPMNDiagram>} [bpmnDiagram] the diagram to be rendered
 * (if not provided, the first one will be rendered)
 *
 * Returns {Promise<ImportBPMNDiagramResult, ImportBPMNDiagramError>}
 */
export function importBpmnDiagram(diagram, definitions, bpmnDiagram) {

  var importer,
      eventBus,
      canvas;

  var error,
      warnings = [];

  return new Promise(function(resolve, reject) {
    try {
      importer = diagram.get('bpmnImporter');
      eventBus = diagram.get('eventBus');
      // translate = diagram.get('translate');
      canvas = diagram.get('canvas');

      eventBus.fire('import.render.start', { definitions: definitions });

      importer.importBpmnDiagram(definitions, bpmnDiagram, canvas, warnings);

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