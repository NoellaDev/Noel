import { FullExtensionConfig } from '../../extensions';
import { GooseFreedom } from './freedom/FreedomLevel';

export interface Model {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface Settings {
  models: Model[];
  extensions: FullExtensionConfig[];
  freedom: GooseFreedom;
}
