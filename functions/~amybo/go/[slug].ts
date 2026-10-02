import { goHandler } from '../../../src/links/server';
import page from '../../../src/links/amybo';

export const onRequestGet = goHandler(page);
