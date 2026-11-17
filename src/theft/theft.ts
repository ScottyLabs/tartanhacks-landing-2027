import type { Loot } from '../bark/bark.ts';
import type { Place } from '../bark/heist.ts';

export interface TheftOptions {
  /** The element positions are measured from; the loose digit is drawn over it. */
  stage: HTMLElement;
  /** The band between the countdown and Bark's ground. Crossing it, the digit is set in paper instead of ink. */
  band: HTMLElement;
  /** The seconds of the countdown: either of their digits can be knocked loose. */
  seconds: HTMLElement;
  /**
   * Offers a loose digit to whoever is to make off with it. False if nobody
   * will have it: then it stays where it is.
   */
  steal: (loot: Loot) => boolean;
}

/** How tall the typeface's figures are, in ems. */
const FIGURE = 0.69;

/**
 * A digit of the seconds can be knocked out of the countdown with a click.
 * Whoever it is offered to makes off with it, and says where it is until it
 * is back. All this file does is the countdown's side of that: which digit,
 * the gap it leaves, and showing it wherever it has got to.
 *
 * The digit that is away is the same digit: it goes on counting down, and
 * its cell keeps its place. What is shown is a copy of it, set by the same
 * rules of the stylesheet as the digit itself, so that it leaves its cell
 * from where the digit stood and comes back to it. The copy is there twice,
 * on two panes of a layer over the stage: in ink, everywhere but the band;
 * and in paper, over the band. At rest nothing here is on screen, and
 * nothing runs.
 */
export class Theft {
  private readonly stage: HTMLElement;
  private readonly band: HTMLElement;
  private readonly seconds: HTMLElement;
  private readonly steal: TheftOptions['steal'];

  private readonly layer: HTMLDivElement;
  /** One pane for everywhere but the band and one for the band; and the copy of the digit on each. */
  private readonly panes: readonly HTMLDivElement[];
  private readonly copies: readonly HTMLSpanElement[];

  /** The digit that is away, if one is; its size; and what it and the band were last shown as. */
  private away: HTMLElement | null = null;
  private em = 0;
  private said = '';
  private bandShown = '';

  constructor(options: TheftOptions) {
    this.stage = options.stage;
    this.band = options.band;
    this.seconds = options.seconds;
    this.steal = options.steal;

    this.layer = document.createElement('div');
    this.layer.className = 'loose';
    this.layer.hidden = true;
    this.layer.setAttribute('aria-hidden', 'true');

    const panes: HTMLDivElement[] = [];
    const copies: HTMLSpanElement[] = [];
    for (const where of ['loose__pane', 'loose__pane loose__pane--band']) {
      const pane = document.createElement('div');
      pane.className = where;
      // A digit in a value, as in the countdown, so that the same rules set it.
      const value = document.createElement('span');
      value.className = 'countdown__value loose__value';
      const copy = document.createElement('span');
      copy.className = 'countdown__digit';
      value.append(copy);
      pane.append(value);
      this.layer.append(pane);
      panes.push(pane);
      copies.push(copy);
    }
    this.panes = panes;
    this.copies = copies;
    this.stage.append(this.layer);

    this.seconds.classList.add('countdown__value--loose');
    this.seconds.addEventListener('click', this.knock);
    window.addEventListener('resize', this.measure, { passive: true });
  }

  /** A click on a digit of the seconds knocks it loose, if there is anybody to make off with it. */
  private readonly knock = (event: MouseEvent): void => {
    if (this.away || !(event.target instanceof Element)) return;
    const digit = event.target.closest<HTMLElement>('.countdown__digit');
    if (!digit || !this.seconds.contains(digit)) return;

    const loot: Loot = {
      home: () => {
        const box = digit.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, tall: this.em * FIGURE };
      },
      move: (place) => this.show(digit, place),
      land: () => this.land(digit),
    };
    this.away = digit;
    this.measure();
    if (!this.steal(loot)) {
      this.away = null;
      return;
    }

    // Shown first where it is, so that the digit does not blink as it leaves its cell.
    const home = loot.home();
    const stage = this.stage.getBoundingClientRect();
    this.show(digit, { x: home.x - stage.left, y: home.y - stage.top, turn: 0, flat: 1 });
    this.layer.hidden = false;
    digit.classList.add('countdown__digit--away');
    this.seconds.classList.add('countdown__value--short');
  };

  /** The size of the digit that is away, which the page sets by its own width. */
  private readonly measure = (): void => {
    if (this.away) this.em = parseFloat(getComputedStyle(this.away).fontSize) || 0;
  };

  /** Shows the digit that is away where it has got to on the stage, saying what it says now. */
  private show(digit: HTMLElement, place: Readonly<Place>): void {
    const text = digit.textContent ?? '';
    if (text !== this.said) {
      this.said = text;
      for (const copy of this.copies) copy.textContent = text;
    }
    // Its middle goes where it is told, whatever size its cell is.
    const transform =
      `translate(${place.x.toFixed(2)}px, ${place.y.toFixed(2)}px) translate(-50%, -50%) ` +
      `rotate(${place.turn.toFixed(2)}deg) scaleX(${place.flat.toFixed(3)})`;
    for (const copy of this.copies) copy.style.transform = transform;

    // Where the band is on the stage: that only changes when the page is resized.
    const stage = this.stage.getBoundingClientRect();
    const band = this.band.getBoundingClientRect();
    const left = `${(band.left - stage.left).toFixed(1)}px`;
    const top = `${(band.top - stage.top).toFixed(1)}px`;
    const right = `${(band.right - stage.left).toFixed(1)}px`;
    const bottom = `${(band.bottom - stage.top).toFixed(1)}px`;
    const box = `${left} ${top}, ${right} ${top}, ${right} ${bottom}, ${left} ${bottom}`;
    if (box === this.bandShown) return;
    this.bandShown = box;
    // The whole stage with the band cut out of it; and the band.
    this.panes[0]!.style.clipPath =
      `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${box}, ${left} ${top})`;
    this.panes[1]!.style.clipPath = `polygon(${box})`;
  }

  /** The digit is back in its cell: it settles there, and can be knocked loose again. */
  private land(digit: HTMLElement): void {
    this.away = null;
    this.layer.hidden = true;
    this.seconds.classList.remove('countdown__value--short');
    digit.classList.remove('countdown__digit--away');
    digit.classList.add('countdown__digit--back');
    digit.addEventListener('animationend', () => digit.classList.remove('countdown__digit--back'), {
      once: true,
    });
  }
}
