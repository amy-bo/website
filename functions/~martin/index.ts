import { viewHandler } from '../../src/links/server';
import page from '../../src/links/martin';

export const onRequestGet = viewHandler(page);
