export class StateMachine {
  constructor({ states, onEnter, onEnd, random = Math.random }) {
    this.states = states;
    this.onEnter = onEnter;
    this.onEnd = onEnd;
    this.random = random;
    this.current = null;
    this.timer = null;
    this.lastFrameByState = new Map();
  }

  pickFrame(stateName, state, preferredFrame) {
    if (preferredFrame && state.frames.includes(preferredFrame)) {
      this.lastFrameByState.set(stateName, preferredFrame);
      return preferredFrame;
    }

    if (state.frames.length === 1) {
      return state.frames[0];
    }

    const previous = this.lastFrameByState.get(stateName);
    const choices = state.frames.filter((frame) => frame !== previous);
    const pool = choices.length ? choices : state.frames;
    const frame = pool[Math.floor(this.random() * pool.length)];
    this.lastFrameByState.set(stateName, frame);
    return frame;
  }

  request(stateName, { force = false, preferredFrame = null } = {}) {
    const state = this.states[stateName];
    if (!state) {
      console.warn(`未知状态：${stateName}`);
      return false;
    }

    if (
      !force &&
      this.current &&
      state.priority < this.current.state.priority
    ) {
      return false;
    }

    clearTimeout(this.timer);
    this.timer = null;
    const frame = this.pickFrame(stateName, state, preferredFrame);
    this.current = { name: stateName, state };
    this.onEnter({ name: stateName, state, frame });

    if (Number.isFinite(state.timeoutMs) && state.timeoutMs > 0) {
      this.timer = setTimeout(() => this.finish(), state.timeoutMs);
    }
    return true;
  }

  finish() {
    if (!this.current) return;
    clearTimeout(this.timer);
    this.timer = null;
    const finished = this.current;
    this.current = null;
    this.onEnd(finished);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.current = null;
  }
}
