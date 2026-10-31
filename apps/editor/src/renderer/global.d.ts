import type { CocoaApi } from '../shared/api';

declare global {
  interface Window {
    cocoa: CocoaApi;
  }
}

export {};
