import 'fake-indexeddb/auto';
import { configurePlatform } from '@tio/app/platform';

import { createWebPlatform } from '../apps/web/src/platform';
configurePlatform(createWebPlatform());
