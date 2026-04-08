import type { PreparedSegmentation } from '../lib/wizardChannel'

/**
 * Pre-prepared segmentation results for WoZ testing.
 *
 * Each entry represents a tumor annotation that the wizard can inject
 * when the participant runs AI. These are organized by scenario (MRI scan).
 *
 * To add new prepared segmentations:
 * 1. Open the wizard panel (?wizard=1)
 * 2. Load the target MRI scan in the app
 * 3. Use the "Preparation Mode" to draw annotations and save them
 * 4. Paste the exported JSON here
 *
 * Or use generateIrregularAnnotations() from viewerStore to create them
 * programmatically with fixed parameters.
 */

export const preparedSegmentations: PreparedSegmentation[] = [
  // ── Scenario 1: Demo DICOM (IMG-0001-00001.dcm) ──
  // These use coordinates relative to the demo DICOM volume.
  // Annotations will be auto-generated on first wizard panel load
  // if this array is empty — the wizard can also create them manually.
]

/**
 * Group prepared segmentations by scenario.
 */
export function getSegmentationsByScenario(): Map<string, PreparedSegmentation[]> {
  const map = new Map<string, PreparedSegmentation[]>()
  for (const seg of preparedSegmentations) {
    const list = map.get(seg.scenarioId) ?? []
    list.push(seg)
    map.set(seg.scenarioId, list)
  }
  return map
}
