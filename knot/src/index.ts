// Common Modules...

// Own Modules...

// Local Fields...

// Beginning of Logic!
export { Operation } from "./Operation";
export { LIST } from "./lists";
export { NO_OP, SET, MATH } from "./values";
export { MISSING, PUT, REM, APPLY } from "./objects";

export function type_name(x) {
  if (typeof x == "object") {
    if (Array.isArray(x)) return "array";
    return "object";
  }
  return typeof x;
}

export function _createRandomOp(doc, context?) {
  // Creates a random operation that could apply to doc. Just
  // chain off to the modules that can handle the data type.

  const modules = [];

  // The values module can handle any data type.
  modules.push();

  // sequences applies to strings and arrays.
  if (typeof doc === "string" || Array.isArray(doc)) {
    modules.push(sequences);
    //modules.push(copies);
  }

  // objects applies to objects (but not Array objects or null)
  else if (typeof doc === "object" && doc !== null) {
    modules.push(objects);
    //modules.push(copies);
  }

  // the lists module only defines LIST which can also
  // be applied to any data type but gives us stack
  // overflows
  //modules.push(lists);

  return modules[Math.floor(Math.random() * modules.length)].createRandomOp(
    doc,
    context
  );
}

export function _createRandomValue(depth) {
  const values = [];

  // null
  values.push(null);

  // boolean
  values.push(false);
  values.push(true);

  // number (integer, float)
  values.push(1000 * Math.floor(Math.random() - 0.5));
  values.push(Math.random() - 0.5);
  values.push(1000 * (Math.random() - 0.5));

  // string
  values.push(Math.random().toString(36).substring(7));

  // array (make nesting exponentially less likely at each level of recursion)
  if (Math.random() < Math.exp(-(depth || 0))) {
    const n = Math.floor(Math.exp(3 * Math.random())) - 1;
    const array = [];
    while (array.length < n) array.push(_createRandomValue((depth || 0) + 1));
    values.push(array);
  }

  // object (make nesting exponentially less likely at each level of recursion)
  if (Math.random() < Math.exp(-(depth || 0))) {
    const n = Math.floor(Math.exp(2.5 * Math.random())) - 1;
    const obj = {};
    while (Object.keys(obj).length < n)
      obj[Math.random().toString(36).substring(7)] = _createRandomValue(
        (depth || 0) + 1
      );
    values.push(obj);
  }

  return values[Math.floor(Math.random() * values.length)];
}

export function createRandomOpSequence(value, count) {
  // Create a random sequence of operations starting with a given value.
  const ops = [];
  while (ops.length < count) {
    // Create random operation.
    var op = _createRandomOp(value);

    // Make the result of applying the op the initial value
    // for the next operation. createRandomOp sometimes returns
    // invalid operations, in which case we'll try again.
    // TODO: Make createRandomOp always return a valid operation
    // and remove the try block.
    try {
      value = op.apply(value);
    } catch (e) {
      continue; // retry
    }

    ops.push(op);
  }
  return new exports.LIST(ops);
}

export function cmp(a, b) {
  // For objects.MISSING, make sure we try object identity.
  if (a === b) return 0;

  // objects.MISSING has a lower sort order so that it tends to get clobbered.
  if (a === exports.MISSING) return -1;
  if (b === exports.MISSING) return 1;

  // Comparing strings to numbers, numbers to objects, etc.
  // just sort based on the type name.
  if (type_name(a) != type_name(b)) {
    return cmp(type_name(a), type_name(b));
  } else if (typeof a == "number") {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  } else if (typeof a == "string") {
    return a.localeCompare(b);
  } else if (Array.isArray(a)) {
    // First compare on length.
    var x = cmp(a.length, b.length);
    if (x != 0) return x;

    // Same length, compare on values.
    for (var i = 0; i < a.length; i++) {
      x = cmp(a[i], b[i]);
      if (x != 0) return x;
    }

    return 0;
  }

  // Compare on strings.
  // TODO: Find a better way to sort objects.
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}
