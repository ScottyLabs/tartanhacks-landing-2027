import { startCountdown } from './countdown.ts';
import { Field } from './field/field.ts';

const root = document.documentElement;

/** Resolves when the wordmark's typeface is usable, or after a short wait. */
function wordmarkFont(): Promise<unknown> {
  const loaded = document.fonts.load("900 100px 'Archivo Wide'", 'TARTANHACKS');
  const patience = new Promise((resolve) => window.setTimeout(resolve, 2500));
  return Promise.race([loaded, patience]).catch(() => undefined);
}

async function main(): Promise<void> {
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('field');
  const countdown = document.getElementById('countdown');
  const dropTime = document.getElementById('drop-time');

  // Start the countdown first: it changes the layout the field measures.
  if (countdown && dropTime instanceof HTMLTimeElement) startCountdown(countdown, dropTime);

  const field =
    stage && canvas instanceof HTMLCanvasElement
      ? Field.create({
          stage,
          canvas,
          inkLines: [...stage.querySelectorAll<HTMLElement>('.wordmark__line')],
          snapTargets: [...stage.querySelectorAll<HTMLElement>('[data-snap]')],
          clearZone: stage.querySelector<HTMLElement>('.sheet__top'),
        })
      : null;

  if (!field) {
    root.classList.add('no-field', 'static');
    return;
  }

  root.classList.add('field-on');
  await wordmarkFont();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('static');
    field.show();
  } else {
    root.classList.add('intro');
    field.play();
  }
}

main().catch((error: unknown) => {
  // Whatever went wrong, never leave the page waiting on an entrance.
  console.error(error);
  root.classList.add('no-field', 'static');
});
