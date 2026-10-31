// v0.14.1 (Raz 2): the screen a render error leaves, and its "try again".
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '@/i18n';

import { ErrorScreen } from './ErrorScreen';

const t = i18n.t.bind(i18n);

it('says something went wrong and retries on tap', async () => {
  const retry = jest.fn(async () => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ErrorScreen error={new TypeError('x')} retry={retry} />
    </SafeAreaProvider>,
  );
  expect(screen.getByText(t('appError.title'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('error-retry'));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith('[app] render error', 'TypeError');
});
