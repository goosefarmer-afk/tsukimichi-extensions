export class BetterSet<T> extends Set<T> {
  /**
   *  Adds multiple items to the set in a single operation.
   * Only items that don't already exist in the set will be added.
   *
   * @param items - An iterable collection of items to add
   * @returns `true` if the set was modified (at least one new item added),
   *          `false` if all items already existed in the set
   *
   *  @example
   * ```typescript
   * const set = new BetterSet([1, 2, 3]);
   * const modified = set.addAll([3, 4, 5]);
   * console.log(modified); // true
   * console.log([...set]); // [1, 2, 3, 4, 5]
   * ```
   */
  addAll(items: Iterable<T>): boolean {
    let modified = false;

    for (const item of items) {
      if (!this.has(item)) {
        this.add(item);
        modified = true;
      }
    }

    return modified;
  }

  /**
   * Moves a specified item to the first position in the set.
   * This operation preserves the relative order of all other items.
   *
   * @param item - The item to move to the front of the set
   *
   * @remarks
   *  - If the item doesn't exist in the set, the method does nothing
   *  - If the item is already first, the method does nothing
   *
   * @example
   * ```typescript
   * const set = new BetterSet(['a', 'b', 'c', 'd']);
   * set.moveItemToFirst('c');
   * console.log([...set]); // ['c', 'a', 'b', 'd']
   * ```
   */
  moveItemToFirst(item: T): void {
    if (!this.has(item)) return;

    const first = this.values().next().value!;

    if (this.#sameValueZero(first, item)) return;

    this.delete(item);

    const items = Array.from(this);
    this.clear();

    this.add(item);
    this.addAll(items);
  }

  /**
   * Groups the set elements by a mapping function and counts how many
   * elements belong to each group.
   *
   * @template K - The type of keys produced by the mapper function
   * @param mapper - A function that maps each set value to a group key.
   *                 Receives the current value and the set instance as arguments.
   * @returns A Map where keys are the group identifiers and values are
   *          the count of elements in each group
   *
   * @example
   * ```typescript
   * const set = new BetterSet(['apple', 'banana', 'apricot', 'blueberry']);
   * const counts = set.countBy(fruit => fruit.charAt(0));
   * console.log(counts); // Map { 'a' => 2, 'b' => 2 }
   * ```
   *
   * @example
   * ```typescript
   * const users = new BetterSet([
   *   { name: 'Alice', role: 'admin' },
   *   { name: 'Bob', role: 'user' },
   *   { name: 'Charlie', role: 'admin' }
   * ]);
   * const roleCounts = users.countBy(user => user.role);
   * console.log(roleCounts); // Map { 'admin' => 2, 'user' => 1 }
   * ```
   */
  countBy<K>(mapper: (value: T, self: BetterSet<T>) => K): Map<K, number> {
    const result = new Map<K, number>();

    for (const value of this) {
      const mappedKey = mapper(value, this);
      result.set(mappedKey, (result.get(mappedKey) ?? 0) + 1);
    }

    return result;
  }

  #sameValueZero(a: T, b: T): boolean {
    return a === b || (a !== a && b !== b);
  }
}
