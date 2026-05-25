import type { StudyCaptureApi } from '../../shared/types.js';

declare global {
  interface Window {
    studyCapture?: StudyCaptureApi;
  }
}

export {};
