export function createTaskQueue(concurrency: number) {
  let active = 0;
  const pending: Array<() => Promise<void>> = [];

  function runNext() {
    while (active < concurrency && pending.length > 0) {
      const task = pending.shift();
      if (!task) return;
      active += 1;
      task().finally(() => {
        active -= 1;
        runNext();
      });
    }
  }

  return {
    add(task: () => Promise<void>) {
      pending.push(task);
      runNext();
    },
  };
}
