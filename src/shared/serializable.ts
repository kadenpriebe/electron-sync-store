/**
 * What may enter the state, enforced by the compiler.
 *
 * Everything that crosses the process boundary goes through V8's structured
 * clone algorithm. Some values throw on the way (a function, a symbol, a
 * promise); worse, some values *silently degrade* — a class instance arrives as
 * a plain object holding only its own data properties, with its prototype, and
 * therefore its methods, gone. No error, no warning, just an object that has
 * quietly stopped being what it was.
 *
 * `Serializable<T>` turns that runtime surprise into a compile error: it maps
 * every property clone cannot carry to `never`, so the offending property stops
 * being assignable and the compiler points at it by name.
 *
 * What it catches, precisely:
 *   - functions and methods, anywhere in the tree
 *   - symbols, promises, WeakMap and WeakSet
 *   - therefore class instances WITH methods, which is the harmful case:
 *     `keyof` a class includes its methods, so a type that rejects
 *     function-valued properties rejects the class.
 *
 * What it cannot catch, and why:
 *   - a class instance with NO methods. TypeScript has no way to tell one from
 *     a plain object with the same fields (microsoft/TypeScript#29063). Such an
 *     instance loses only its prototype identity, which is the benign case.
 *   - getters, which clone captures once and turns into plain data properties.
 *
 * Prior art: `type-fest` exports a `StructuredCloneable` type. The type itself
 * is not novel; wiring it into the state boundary of an Electron store is what
 * is being done here.
 */

/** Values structured clone copies as themselves, without descending into them. */
type CloneableLeaf =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | Date
  | RegExp
  | Error
  | ArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/**
 * `T` if it can survive the crossing; the same shape with the offending
 * properties replaced by `never` if it cannot.
 *
 * The order of the branches matters: leaves are matched before the general
 * object case so a `Date` is not walked as if it were a record, and functions
 * are matched before objects because a function IS an object.
 */
export type Serializable<T> = T extends CloneableLeaf
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends symbol
      ? never
      : T extends Promise<unknown>
        ? never
        : T extends WeakMap<WeakKey, unknown>
          ? never
          : T extends WeakSet<WeakKey>
            ? never
            : T extends ReadonlyArray<unknown>
              ? { [K in keyof T]: Serializable<T[K]> }
              : T extends Map<infer K, infer V>
                ? Map<Serializable<K>, Serializable<V>>
                : T extends Set<infer U>
                  ? Set<Serializable<U>>
                  : T extends object
                    ? { [K in keyof T]: Serializable<T[K]> }
                    : never;
