import type { EducationalDescription } from '../types/viewer'

export const educationalDescriptions: Record<string, EducationalDescription> = {
  Tumor: {
    title: 'Brain Tumor',
    pathology:
      'Brain tumors arise from abnormal cell growth within the cranial cavity. They may be primary (originating in the brain) or metastatic (spreading from elsewhere). Gliomas — the most common primary type — develop from glial cells and range from low-grade (slow-growing) to high-grade (aggressive, e.g. glioblastoma).',
    imagingFeatures:
      'On T1-weighted MRI, tumors typically appear hypointense relative to normal white matter. On T2/FLAIR sequences they are hyperintense, reflecting increased water content. Contrast-enhanced T1 may show ring enhancement in high-grade tumors, indicating blood–brain barrier breakdown. Perilesional edema is common.',
    clinicalContext:
      'Accurate delineation of tumor boundaries is critical for surgical planning and radiotherapy targeting. Residual tumor volume after resection correlates with patient outcomes. AI-assisted segmentation helps standardize measurements and may reduce inter-observer variability.',
  },
}
