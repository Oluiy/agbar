import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { abortOnInterrupt, type InterruptHost } from "./interrupt.js";

function fakeHost() {
  const emitter = new EventEmitter();
  const exits: number[] = [];
  const host: InterruptHost = {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    exit: (code) => void exits.push(code),
  };
  return { host, exits, press: () => emitter.emit("SIGINT"), listeners: () => emitter.listenerCount("SIGINT") };
}

describe("abortOnInterrupt", () => {
  it("the first Ctrl-C aborts the signal and does not exit", () => {
    const { host, exits, press } = fakeHost();
    const controller = new AbortController();
    let told = 0;
    abortOnInterrupt(controller, () => told++, host);

    press();

    expect(controller.signal.aborted).toBe(true);
    expect(told).toBe(1);
    expect(exits).toEqual([]);
  });

  it("the second Ctrl-C force-quits with 130", () => {
    const { host, exits, press } = fakeHost();
    abortOnInterrupt(new AbortController(), () => {}, host);

    press();
    press();

    expect(exits).toEqual([130]);
  });

  it("disposing removes the handler, so Ctrl-C is not swallowed after the phase", () => {
    const { host, listeners } = fakeHost();
    const dispose = abortOnInterrupt(new AbortController(), () => {}, host);
    expect(listeners()).toBe(1);

    dispose();

    expect(listeners()).toBe(0);
  });
});
