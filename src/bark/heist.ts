import type { Ground } from './mind.ts';
import { clamp, Spring } from './motion.ts';

/**
 * A theft, from start to finish. Something is knocked loose from where it
 * belongs, under Bark's ground. It flies up and lands on his ground; he
 * takes it in his mouth and makes off with it; he keeps away with it for as
 * long as anybody is after him; and in the end he brings it back and sends
 * it home.
 *
 * This file is the whole of that as arithmetic: where the thing is, and what
 * Bark is to do about it. It knows nothing about the page, or about how he
 * is drawn. Places are measured as the pointer's is: along his ground and
 * above it, in CSS pixels, so that under his ground is below zero.
 *
 * It always ends. However he is chased, and whatever else happens, the
 * thing is home again within a quarter of a minute or so.
 */

export interface Point {
  x: number;
  y: number;
}

/** Where the thing belongs: its middle, and how tall it is. */
export interface Home extends Point {
  tall: number;
}

/** Where the thing is to be drawn. */
export interface Place {
  /** Its middle. */
  x: number;
  y: number;
  /** How far it has turned, in degrees, clockwise. */
  turn: number;
  /** How much of its width shows: 1 face on, 0 edge on, as he turns round with it. */
  flat: number;
}

/** Bark, as far as a theft needs to know him. */
export interface Thief {
  /** His middle, along the ground. */
  x: number;
  /** How fast he is going, as a share of his full run; the sign is the way. */
  pace: number;
  /** 1 facing right, -1 facing left, in between while he turns round. */
  facing: number;
  /** True when he is on his feet, on the ground, and all but still. */
  settled: boolean;
}

/** What Bark is to do about it, for one frame. */
export interface Plan {
  /** Where to go along the ground, and at how many times his full run. */
  goal: number;
  pace: number;
  /** Which way to face once he is standing: 1 right, -1 left, 0 as he pleases. */
  face: -1 | 0 | 1;
  /** What to keep his eyes on, if anything. */
  eye: Point | null;
  /** How far to bow, front down and rump up, from 0 to 1. */
  bow: number;
  /** Where his nose goes: 1 down to the ground, -1 thrown up, 0 as it was. */
  nose: number;
  /** A hop to make now, this many body heights high; 0 for none. */
  hop: number;
}

/* ---------- Distances are in body heights, times in seconds, unless they say otherwise. ---------- */

/** Things in his world fall as he does: this fast, per second, per second. */
const FALL = 30;

/** Knocked loose, it tops out this far above his ground. */
const PEAK = 1.05;
/**
 * It never comes up through him, or down on him. From his middle to the end
 * of his nose or his rump is this far, with room to spare; where it crosses
 * his ground it is at least that, and half its own height, from his middle.
 * Where it lands it is at least this far from him.
 */
const BODY = 0.9;
const CLEAR = 1.2;
/** Standing further than this from where it goes up, he is out of its way, and it comes down this far to his side. */
const OUT_OF_THE_WAY = 1.6;
const TOWARD = 0.35;
/** Nearer than this to straight above it, he is over it: it lands on the side he is facing. */
const OVER_IT = 0.25;
/** It bounces once: this high, going on this far, and rocking this many degrees as it does. */
const BOUNCE = 0.15;
const SKIP = 0.12;
const ROCK = 9;

/** Once it has come to rest he looks at it for this long before he goes for it. */
const LOOK_S = 0.2;
/** From the drawing: his mouth is this far ahead of his middle, and the end of his nose this far. */
const MOUTH_AHEAD = 0.51;
const NOSE_AHEAD = 0.58;
/** To take it he stands with this much ground between the end of his nose and its near side. */
const SHORT_OF = 0.06;
/** He is where he was going once he is this near it. */
const THERE = 0.09;
/** Waiting on him to get somewhere, it waits this long and no longer. */
const PATIENCE_S = 6;

/** Taking it, his nose is down for this long; this far in, it is in his teeth. */
const TAKE_S = 0.3;
const GRIP_S = 0.13;
/** From where it lay it comes up into his mouth this quickly: the time to close most of the way. */
const SNATCH_S = 0.05;

/**
 * In his mouth. Its middle is this far ahead of his mouth and above it, in
 * its own heights; it is tipped back toward him by this many degrees, and by
 * this many more at a full run, lagging behind him as he starts and stops.
 */
const AHEAD = 0.36;
const ABOVE = 0.1;
const TIPPED = 10;
const DRAG = 12;

/** Making off with it, he runs this far at a time, at this many times his full run. */
const RUN = 3.4;
const DASH = 1.3;
/** With less room than this left ahead of him, he doubles back instead. */
const ROOM = 1.6;
/**
 * How near the pointer may come before he bolts. Each time it is nearer;
 * after the last he has had enough, and lets it come right up to him.
 */
const SHY = [2.6, 2.0, 1.4] as const;
/** He takes this long to see it coming; and having pulled up, he stands at least this long before he is off again. */
const REACT_S = 0.07;
const PAUSE_S = 0.3;
/** The pointer is on him within this distance of his middle; on him for this long, he is caught. */
const ON_HIM = 0.6;
const CAUGHT_S = 0.3;

/** Standing off with it he bows to play: down for this long, then up for this long, and again. */
const BOW_S = 0.85;
const UP_S = 0.3;
/**
 * With nobody after him he brings it back after this long. He comes sooner
 * for a pointer that waits where the thing belongs, within this distance of
 * it. And he never has it for longer than this, whatever happens.
 */
const BORED_S = 3.2;
const CALLED_S = 1.6;
const CALL_WITHIN = 1.6;
const KEEP_S = 10;

/** Sending it home: he winds up for this long, then tosses it this far above his mouth, with a hop this high. */
const WIND_S = 0.16;
const LOB = 0.45;
const TOSS_HOP = 0.16;
/** His head stays thrown up this long after the toss. */
const FLICK_S = 0.14;
/** When it lands by him, and when he is caught, he starts: a hop this high. */
const START = 0.14;

/**
 * rising     knocked loose, on its way up to his ground
 * bouncing   it has landed, and bounces once
 * lying      at rest on his ground: he looks at it, and goes to it
 * taking     his nose is down to it
 * keeping    it is in his mouth, and he keeps away with it
 * returning  it is in his mouth, and he is bringing it back
 * tossing    he winds up to send it home
 * falling    on its way home
 */
type Phase =
  | 'rising'
  | 'bouncing'
  | 'lying'
  | 'taking'
  | 'keeping'
  | 'returning'
  | 'tossing'
  | 'falling';

export class Heist {
  private phase: Phase | null = null;
  /** Time spent in this phase, or in this part of it. */
  private time = 0;

  private readonly home: Home = { x: 0, y: 0, tall: 0 };
  /** Where the thing is. */
  private readonly at: Place = { x: 0, y: 0, turn: 0, flat: 1 };

  /**
   * A throw under way: where it began and where it is going, how long it
   * takes, how far its path arches above the straight line between the two,
   * and how it turns: from so many degrees, by so many more.
   */
  private readonly from: Point = { x: 0, y: 0 };
  private readonly to: Point = { x: 0, y: 0 };
  private flightS = 1;
  private arch = 0;
  private turnFrom = 0;
  private turnBy = 0;

  /** Which way it travels as it comes up, and which side of it Bark goes about his business from. */
  private spin: 1 | -1 = 1;
  private side: 1 | -1 = 1;
  /** Where he is to stand: to take it, and to send it home. */
  private stand = 0;

  /** True while it is in his mouth, and in the frame his teeth close on it. */
  private inMouth = false;
  private grabbed = false;
  /** How far it still is from its place in his mouth, having just been taken. */
  private readonly slip = { x: 0, y: 0, turn: 0 };
  /** How far it swings back as he runs, in degrees. */
  private readonly sway = new Spring(0);

  /** How long he has had it; where he is dashing to, if he is; and how often he has been made to bolt. */
  private kept = 0;
  private dashTo: number | null = null;
  private bolted = 0;
  /** How long the pointer has been too near, has been on him, and has waited where the thing belongs. */
  private pressed = 0;
  private onHim = 0;
  private calledFor = 0;
  /** Caught, or given up; and a start he has yet to give. */
  private done = false;
  private startle = false;

  private readonly plan: Plan = { goal: 0, pace: 1, face: 0, eye: null, bow: 0, nose: 0, hop: 0 };

  /** True from the moment the thing is knocked loose until it is home again. */
  get on(): boolean {
    return this.phase !== null;
  }

  /**
   * Knocks the thing loose from where it belongs. It comes up onto his
   * ground beside him. Ignored, and false, if a theft is already under way.
   */
  begin(home: Home, thief: { x: number; facing: number }, ground: Ground): boolean {
    if (this.phase !== null) return false;
    this.belongs(home);
    const size = ground.size;
    this.at.x = home.x;
    this.at.y = home.y;
    this.at.turn = 0;
    this.at.flat = 1;
    // How high it goes and how long it takes do not depend on where along
    // his ground it comes down, so that can be chosen once they are known.
    this.launch(PEAK * size, home.x, home.tall / 2, FALL * size, 0);
    this.to.x = clamp(this.landing(thief, ground), ground.left, ground.right);
    this.spin = this.to.x >= home.x ? 1 : -1;
    this.turnBy = 360 * this.spin;

    this.phase = 'rising';
    this.inMouth = false;
    this.grabbed = false;
    this.done = false;
    this.startle = false;
    this.dashTo = null;
    this.sway.value = 0;
    this.sway.velocity = 0;
    return true;
  }

  /**
   * Where along his ground the thing comes down, having just been thrown up
   * from where it belongs: beside him, and by a path that keeps clear of him.
   */
  private landing(thief: { x: number; facing: number }, ground: Ground): number {
    const size = ground.size;
    const home = this.home;
    /** How far he is from straight above it; positive when it goes up on his right. */
    const off = home.x - thief.x;
    if (Math.abs(off) > OUT_OF_THE_WAY * size) return home.x - Math.sign(off) * TOWARD * size;

    // The share of its flight that is over when it comes up through his
    // ground: by then it has to be past the end of him.
    const up = this.to.y - this.from.y + this.arch;
    const surfaces = (up - Math.sqrt(up * up + 4 * this.arch * this.from.y)) / (2 * this.arch);
    const body = BODY * size + home.tall / 2;
    const land = (way: 1 | -1): number => {
      const beside = thief.x + way * CLEAR * size;
      const past = home.x + (way * Math.max(0, body - way * off)) / Math.max(0.05, surfaces);
      return way > 0 ? Math.max(beside, past) : Math.min(beside, past);
    };
    // On its own side of him; or, with him right over it, in front of his
    // nose. The other side, if there is no ground there.
    const way = Math.abs(off) > OVER_IT * size ? (off > 0 ? 1 : -1) : thief.facing >= 0 ? 1 : -1;
    const x = land(way);
    return x >= ground.left && x <= ground.right ? x : land(way === 1 ? -1 : 1);
  }

  /** Says where the thing belongs now: the page can move under it. */
  belongs(home: Home): void {
    this.home.x = home.x;
    this.home.y = home.y;
    this.home.tall = home.tall;
  }

  /**
   * He has been caught with it, by a press on him. He gives it up, and takes
   * it back. False if he had nothing to be caught with.
   */
  caught(): boolean {
    if (this.phase !== 'keeping') return false;
    this.done = true;
    this.startle = true;
    return true;
  }

  /**
   * Throws the thing from where it is to (x, y), by way of a height `peak`,
   * turning `turnBy` degrees on the way.
   */
  private launch(peak: number, x: number, y: number, g: number, turnBy: number): void {
    this.from.x = this.at.x;
    this.from.y = this.at.y;
    this.to.x = x;
    this.to.y = y;
    const top = Math.max(peak, this.from.y, y);
    // Up to the top at the speed that just gets it there, and down again.
    this.flightS = (Math.sqrt(2 * g * (top - this.from.y)) + Math.sqrt(2 * g * (top - y))) / g;
    this.arch = (g * this.flightS * this.flightS) / 2;
    this.turnFrom = this.at.turn;
    this.turnBy = turnBy;
    this.time = 0;
  }

  /**
   * Moves the thing along its throw, and says how much of it is done, from 0
   * to 1. Where it is going can move while it is in the air; it still arrives.
   */
  private fly(): number {
    const s = Math.min(1, this.time / this.flightS);
    this.at.x = this.from.x + (this.to.x - this.from.x) * s;
    this.at.y = this.from.y + (this.to.y - this.from.y) * s + this.arch * s * (1 - s);
    this.at.turn = this.turnFrom + this.turnBy * s;
    return s;
  }

  /** Sets him running off with it: away from whoever is after him, or back past them if he is cornered. */
  private bolt(thief: Thief, pointer: Point | null, ground: Ground): void {
    const after = pointer ? pointer.x : this.home.x;
    let way = thief.x >= after ? 1 : -1;
    const room = way > 0 ? ground.right - thief.x : thief.x - ground.left;
    if (room < ROOM * ground.size) way = -way;
    this.dashTo = clamp(thief.x + way * RUN * ground.size, ground.left, ground.right);
    this.pressed = 0;
    this.onHim = 0;
    this.calledFor = 0;
  }

  /** Where he stands to be `reach` short of a place along the ground, on his own side of it. */
  private standBy(x: number, reach: number, ground: Ground): number {
    return clamp(x - this.side * reach, ground.left, ground.right);
  }

  /** True once he is standing where he was sent, facing the way he was told; or has been waited on long enough. */
  private arrived(thief: Thief, size: number): boolean {
    return (
      (Math.abs(thief.x - this.stand) < THERE * size &&
        thief.settled &&
        Math.abs(thief.facing - this.side) < 0.2) ||
      this.time > PATIENCE_S
    );
  }

  /**
   * Advances the theft by `dt` seconds, and says what Bark is to do. The
   * plan is the same object every time, good until the next step.
   */
  step(dt: number, thief: Thief, pointer: Point | null, ground: Ground): Plan {
    const plan = this.plan;
    plan.goal = thief.x;
    plan.pace = 1;
    plan.face = 0;
    plan.eye = null;
    plan.bow = 0;
    plan.nose = 0;
    plan.hop = 0;
    if (this.phase === null) return plan;

    const size = ground.size;
    const g = FALL * size;
    const half = this.home.tall / 2;
    this.time += dt;

    // In his mouth it swings back as he runs, and what is left of the snatch closes up.
    this.sway.step(DRAG * Math.abs(thief.pace), 130, 9, dt);
    const closing = Math.exp(-dt / SNATCH_S);
    this.slip.x *= closing;
    this.slip.y *= closing;
    this.slip.turn *= closing;

    if (this.startle) {
      this.startle = false;
      plan.hop = START;
    }

    switch (this.phase) {
      case 'rising': {
        plan.eye = this.at;
        // He keeps out from under it.
        const off = thief.x - this.to.x;
        if (Math.abs(off) < CLEAR * size) plan.goal = this.to.x + (off >= 0 ? 1 : -1) * CLEAR * size;
        if (this.fly() >= 1) {
          this.at.turn = 0;
          const on = clamp(this.to.x + this.spin * SKIP * size, ground.left, ground.right);
          this.launch(half + BOUNCE * size, on, half, g, 0);
          this.phase = 'bouncing';
          plan.hop = START;
        }
        break;
      }

      case 'bouncing': {
        plan.eye = this.at;
        const s = this.fly();
        this.at.turn = this.spin * ROCK * Math.sin(Math.PI * s);
        if (s >= 1) {
          this.at.turn = 0;
          this.phase = 'lying';
          this.time = 0;
          this.side = thief.x <= this.at.x ? 1 : -1;
          // Short of it, so that it lies in front of his nose and not under his feet.
          this.stand = this.standBy(this.at.x, (NOSE_AHEAD + SHORT_OF) * size + half, ground);
        }
        break;
      }

      case 'lying': {
        plan.eye = this.at;
        if (this.time < LOOK_S) break;
        plan.goal = this.stand;
        plan.face = this.side;
        if (this.arrived(thief, size)) {
          this.phase = 'taking';
          this.time = 0;
        }
        break;
      }

      case 'taking': {
        plan.goal = this.stand;
        plan.face = this.side;
        plan.nose = 1;
        plan.bow = 0.5;
        if (!this.inMouth && this.time >= GRIP_S) {
          this.inMouth = true;
          this.grabbed = true;
        }
        if (this.time >= TAKE_S) {
          this.phase = 'keeping';
          this.time = 0;
          this.kept = 0;
          this.bolted = 0;
          this.bolt(thief, pointer, ground);
        }
        break;
      }

      case 'keeping': {
        this.kept += dt;
        if (this.dashTo !== null) {
          plan.goal = this.dashTo;
          plan.pace = DASH;
          if (Math.abs(thief.x - this.dashTo) < 0.3 * size) {
            this.dashTo = null;
            this.time = 0;
          }
        } else {
          // Standing off, he faces whoever might come after him, and bows to play.
          plan.eye = pointer ?? this.home;
          plan.bow = this.time % (BOW_S + UP_S) < BOW_S ? 1 : 0.2;

          const off = pointer ? Math.hypot(pointer.x - thief.x, pointer.y - 0.5 * size) : Infinity;
          const called =
            pointer !== null &&
            Math.hypot(pointer.x - this.home.x, pointer.y - this.home.y) < CALL_WITHIN * size;
          const shy = SHY[this.bolted];
          this.pressed = shy !== undefined && off < shy * size ? this.pressed + dt : 0;
          this.onHim = off < ON_HIM * size ? this.onHim + dt : 0;
          this.calledFor = called ? this.calledFor + dt : 0;

          if (this.pressed >= REACT_S && this.time >= PAUSE_S) {
            this.bolted += 1;
            this.bolt(thief, pointer, ground);
          } else if (
            this.onHim >= CAUGHT_S ||
            this.calledFor >= CALLED_S ||
            this.time >= BORED_S
          ) {
            this.done = true;
          }
        }
        if (this.done || this.kept >= KEEP_S) {
          this.phase = 'returning';
          this.time = 0;
          this.dashTo = null;
          this.side = thief.x <= this.home.x ? 1 : -1;
        }
        break;
      }

      case 'returning': {
        // With what is in his mouth right above where it belongs.
        this.stand = this.standBy(this.home.x, MOUTH_AHEAD * size + AHEAD * this.home.tall, ground);
        plan.goal = this.stand;
        plan.face = this.side;
        if (this.arrived(thief, size)) {
          this.phase = 'tossing';
          this.time = 0;
        }
        break;
      }

      case 'tossing': {
        plan.goal = this.stand;
        plan.face = this.side;
        if (this.time < WIND_S) {
          plan.nose = 0.7;
          plan.bow = 0.3;
          break;
        }
        // He lets go. From here it is a thrown thing again: one whole turn, and home.
        this.inMouth = false;
        this.at.flat = 1;
        this.launch(this.at.y + LOB * size, this.home.x, this.home.y, g, 360 * this.side - this.at.turn);
        this.phase = 'falling';
        plan.nose = -1;
        plan.hop = TOSS_HOP;
        break;
      }

      case 'falling': {
        plan.goal = this.stand;
        plan.face = this.side;
        plan.eye = this.at;
        if (this.time < FLICK_S) plan.nose = -1;
        this.to.x = this.home.x;
        this.to.y = this.home.y;
        if (this.fly() >= 1) this.phase = null;
        break;
      }
    }
    return plan;
  }

  /**
   * Where the thing is, given where his mouth is and which way he faces, as
   * they will be drawn this frame. Null when it is home, and not his to
   * place. The place is the same object every time, good until the next call.
   */
  place(mouth: Point, facing: number): Place | null {
    if (this.phase === null) return null;
    if (!this.inMouth) return this.at;

    const tall = this.home.tall;
    const x = mouth.x + facing * AHEAD * tall;
    const y = mouth.y + ABOVE * tall;
    const turn = -facing * (TIPPED + this.sway.value);
    if (this.grabbed) {
      // His teeth have just closed on it where it lay: it comes up from there.
      this.grabbed = false;
      this.slip.x = this.at.x - x;
      this.slip.y = this.at.y - y;
      this.slip.turn = this.at.turn - turn;
    }
    this.at.x = x + this.slip.x;
    this.at.y = y + this.slip.y;
    this.at.turn = turn + this.slip.turn;
    this.at.flat = Math.abs(facing);
    return this.at;
  }
}
