// Sprint 13 AC-9: a transition logs once, from its tap to its first layout.
import { logTransition, markTransition } from './perfLog';

it('logs a marked transition once, and nothing without a mark', () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  logTransition('card');
  expect(log).not.toHaveBeenCalled();
  markTransition('card');
  logTransition('card');
  logTransition('card');
  expect(log).toHaveBeenCalledTimes(1);
  expect(log.mock.calls[0]![0]).toMatch(/^\[perf\] transition card ms=\d+$/);
  log.mockRestore();
});
