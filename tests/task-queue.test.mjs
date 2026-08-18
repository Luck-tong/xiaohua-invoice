import assert from "node:assert/strict";
import test from "node:test";

import { createTaskQueue } from "../app/task-queue.ts";

test("runs no more than three invoice tasks at once", async () => {
  const queue = createTaskQueue(3);
  let active = 0;
  let peak = 0;
  let completed = 0;

  await new Promise((resolve) => {
    for (let index = 0; index < 12; index += 1) {
      queue.add(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((done) => setTimeout(done, 5));
        active -= 1;
        completed += 1;
        if (completed === 12) resolve();
      });
    }
  });

  assert.equal(peak, 3);
});
