// Sprint 15 QA 1: a message the caller already announced isn't a live region
// too, so TalkBack reads it once; other toasts and notices stay live.
import { render, screen } from '@testing-library/react-native';

import { InlineNotice, Toast } from './formControls';

it('a toast is live unless already announced', async () => {
  await render(<Toast text="a" top={0} onDone={jest.fn()} long />);
  expect(screen.getByTestId('toast').props.accessibilityLiveRegion).toBe('assertive');
  await render(<Toast text="b" top={0} onDone={jest.fn()} long announced />);
  expect(screen.getByTestId('toast').props.accessibilityLiveRegion).toBe('none');
});

it('a notice is polite unless already announced', async () => {
  await render(<InlineNotice text="a" colorScheme="light" testID="n" />);
  expect(screen.getByTestId('n').props.accessibilityLiveRegion).toBe('polite');
  await render(<InlineNotice text="b" colorScheme="light" testID="n" announced />);
  expect(screen.getByTestId('n').props.accessibilityLiveRegion).toBe('none');
});
