/**
 * Utility helpers for creating debounced functions that coalesce rapid-fire calls.
 * Inspired by VS Code's event debouncer implementation.
 */

export interface DebouncedAsyncOptions<TArg> {
    /**
     * Delay in milliseconds before executing the underlying function.
     * When zero, the function is deferred to the next microtask.
     */
    delay?: number;
    /**
     * Merge strategy for pending arguments. The merged value will be passed
     * to the debounced function when it executes.
     */
    merge?: (previous: TArg | undefined, next: TArg) => TArg;
}

export interface DebouncedAsync<TArg, TResult> {
    (arg: TArg): Promise<TResult>;
    cancel(reason?: Error): void;
    dispose(): void;
}

const microtask = typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (cb: () => void) => setTimeout(cb, 0);

export function createDebouncedAsync<TArg, TResult>(
    fn: (arg: TArg) => Promise<TResult>,
    options: DebouncedAsyncOptions<TArg> = {},
): DebouncedAsync<TArg, TResult> {
    const { delay = 0, merge } = options;

    let pendingArg: TArg | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let disposed = false;

    let resolvers: Array<(value: TResult) => void> = [];
    let rejecters: Array<(reason?: unknown) => void> = [];

    const scheduleRun = () => {
        if (disposed || pendingArg === undefined) {
            return;
        }
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (delay === 0) {
            microtask(run);
        } else {
            timer = setTimeout(run, delay);
        }
    };

    const run = () => {
        if (running || disposed || pendingArg === undefined) {
            return;
        }

        const arg = pendingArg;
        pendingArg = undefined;
        const currentResolvers = resolvers;
        const currentRejecters = rejecters;
        resolvers = [];
        rejecters = [];
        timer = undefined;
        running = true;

        fn(arg)
            .then(
                result => {
                    currentResolvers.forEach(resolve => resolve(result));
                },
                error => {
                    const hadConsumers = currentRejecters.length > 0;
                    currentRejecters.forEach(reject => reject(error));
                    if (!hadConsumers) {
                        throw error;
                    }
                },
            )
            .finally(() => {
                running = false;
                if (pendingArg !== undefined && !disposed) {
                    scheduleRun();
                }
            });
    };

    const debounced = ((arg: TArg) => {
        if (disposed) {
            return Promise.reject(new Error('Debounced function disposed'));
        }

        pendingArg = merge ? merge(pendingArg, arg) : arg;
        scheduleRun();

        return new Promise<TResult>((resolve, reject) => {
            resolvers.push(resolve);
            rejecters.push(reject);
        });
    }) as DebouncedAsync<TArg, TResult>;

    debounced.cancel = (reason?: Error) => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (pendingArg === undefined && resolvers.length === 0 && rejecters.length === 0) {
            return;
        }

        pendingArg = undefined;
        const error = reason ?? new Error('Debounced function cancelled');
        rejecters.forEach(reject => reject(error));
        resolvers = [];
        rejecters = [];
    };

    debounced.dispose = () => {
        if (disposed) return;
        disposed = true;
        debounced.cancel(new Error('Debounced function disposed'));
    };

    return debounced;
}
