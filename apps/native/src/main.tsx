import { mountApp } from '@tio/app';

import { createNativePlatform } from './platform';
mountApp(await createNativePlatform());
