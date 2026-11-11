import { render } from 'preact';
import { App } from './app/App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './ui/ui.css';
import './app/shell.css';

const root = document.getElementById('app');
if (root) render(<App />, root);
