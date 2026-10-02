import { goHandler } from '../../../src/links/server';
import page from '../../../src/links/martin';

export const onRequestGet = goHandler(page);
