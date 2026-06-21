import { RouterProvider } from 'react-router';
import { router } from './routes';
import { ThemeProvider } from './components/primitives/theme-provider';

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />;
    </ThemeProvider>
  );
}
