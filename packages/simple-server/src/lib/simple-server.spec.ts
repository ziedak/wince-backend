import { simpleServer } from './simple-server.js';

describe('simpleServer', () => {
  it('should work', () => {
    expect(simpleServer()).toEqual('simple-server');
  });
});
