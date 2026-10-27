import { Game } from './game/Game';
import './ui/styles.css';

const container = document.getElementById('app')!;
const game = new Game(container);
game.boot().catch((err: unknown) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = 'Something went wrong while loading. Please reload.';
});
