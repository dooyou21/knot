/* A library of operations for objects (i.e. JSON objects/Javascript associative arrays).

   new objects.PUT(key, value)
    
    Creates a property with the given value. This is an alias for
    new objects.APPLY(key, new values.SET(value)).

   new objects.REM(key)
    
    Removes a property from an object. This is an alias for
    new objects.APPLY(key, new values.SET(objects.MISSING)).

   new objects.APPLY(key, operation)
   new objects.APPLY({key: operation, ...})

    Applies any operation to a property, or multiple operations to various
    properties, on the object.

    Use any operation defined in any of the modules depending on the data type
    of the property. For instance, the operations in values.js can be
    applied to any property. The operations in sequences.js can be used
    if the property's value is a string or array. And the operations in
    this module can be used if the value is another object.

    Supports a conflictless rebase with itself with the inner operations
    themselves support a conflictless rebase. It does not generate conflicts
    with any other operations in this module.

    Example:
    
    To replace the value of a property with a new value:
    
      new objects.APPLY("key1", new values.SET("value"))

	or

      new objects.APPLY({ key1: new values.SET("value") })

   */

import util from 'util';
import {
  add_op,
  Operation,
  createRandomOp,
  createRandomValue,
  opFromJSON,
} from './index';
import { clone } from 'lodash';
import { NO_OP, SET } from './values';

//////////////////////////////////////////////////////////////////////////////

exports.module_name = 'objects'; // for serialization/deserialization

export function APPLY(var1?: any, var2?: any) {
  if (arguments.length == 1 && typeof arguments[0] == 'object') {
    // Dict form.
    this.ops = arguments[0];
  } else if (arguments.length == 2 && typeof arguments[0] == 'string') {
    // key & operation form.
    this.ops = {};
    this.ops[arguments[0]] = arguments[1];
  } else {
    throw new Error('invalid arguments');
  }
  Object.freeze(this);
  Object.freeze(this.ops);
}
APPLY.prototype = Object.create(Operation.prototype); // inherit
add_op(APPLY, exports, 'APPLY');

// The MISSING object is a sentinel to signal the state of an Object property
// that does not exist. It is the old_value to SET when adding a new property
// and the value when removing a property.
export const MISSING = new Object();
Object.freeze(MISSING);

export function PUT(key, value) {
  APPLY.apply(this, [key, new SET(value)]);
}
PUT.prototype = Object.create(APPLY.prototype); // inherit prototype

export function REM(key, val2?) {
  APPLY.apply(this, [key, new SET(MISSING)]);
}
REM.prototype = Object.create(APPLY.prototype); // inherit prototype

//////////////////////////////////////////////////////////////////////////////

APPLY.prototype.inspect = function (depth) {
  var inner = [];
  var ops = this.ops;
  Object.keys(ops).forEach(function (key) {
    inner.push(util.format('%j:%s', key, ops[key].inspect(depth - 1)));
  });
  return util.format('<APPLY %s>', inner.join(', '));
};

APPLY.prototype.visit = function (visitor) {
  // A simple visitor paradigm. Replace this operation instance itself
  // and any operation within it with the value returned by calling
  // visitor on itself, or if the visitor returns anything falsey
  // (probably undefined) then return the operation unchanged.
  var ops = {};
  for (var key in this.ops) ops[key] = this.ops[key].visit(visitor);
  var ret = new APPLY(ops);
  return visitor(ret) || ret;
};

APPLY.prototype.internalToJSON = function (json, protocol_version) {
  json.ops = {};
  for (var key in this.ops)
    json.ops[key] = this.ops[key].toJSON(undefined, protocol_version);
};

APPLY.internalFromJSON = function (json, protocol_version, op_map) {
  var ops = {};
  for (var key in json.ops)
    ops[key] = opFromJSON(json.ops[key], protocol_version, op_map);
  return new APPLY(ops);
};

APPLY.prototype.apply = function (document) {
  /* Applies the operation to a document. Returns a new object that is
	   the same type as document but with the change made. */

  // Clone first.
  var d = {};
  for (var k in document) d[k] = document[k];

  // Apply. Pass the object and key down in the second argument
  // to apply so that values.SET can handle the special MISSING
  // value.
  for (var key in this.ops) {
    var value = this.ops[key].apply(d[key], [d, key]);
    if (value === MISSING) delete d[key];
    // key was removed
    else d[key] = value;
  }
  return d;
};

APPLY.prototype.simplify = function () {
  /* Returns a new atomic operation that is a simpler version
	   of this operation. If there is no sub-operation that is
	   not a NO_OP, then return a NO_OP. Otherwise, simplify all
	   of the sub-operations. */
  var new_ops = {};
  var had_non_noop = false;
  for (var key in this.ops) {
    new_ops[key] = this.ops[key].simplify();
    if (!(new_ops[key] instanceof NO_OP))
      // Remember that we have a substantive operation.
      had_non_noop = true;
    // Drop internal NO_OPs.
    else delete new_ops[key];
  }
  if (!had_non_noop) return new NO_OP();
  return new APPLY(new_ops);
};

APPLY.prototype.inverse = function (document) {
  /* Returns a new atomic operation that is the inverse of this operation,
	   given the state of the document before this operation applies. */
  var new_ops = {};
  for (var key in this.ops) {
    new_ops[key] = this.ops[key].inverse(
      key in document ? document[key] : MISSING,
    );
  }
  return new APPLY(new_ops);
};

APPLY.prototype.atomic_compose = function (other: { ops }) {
  /* Creates a new atomic operation that has the same result as this
	   and other applied in sequence (this first, other after). Returns
	   null if no atomic operation is possible. */

  // two APPLYs
  if (other instanceof APPLY) {
    // Start with a clone of this operation's suboperations.
    var new_ops = clone(this.ops);

    // Now compose with other.
    for (var key in other.ops) {
      if (!(key in new_ops)) {
        // Operation in other applies to a key not present
        // in this, so we can just merge - the operations
        // happen in parallel and don't affect each other.
        new_ops[key] = other.ops[key];
      } else {
        // Compose.
        var op2 = new_ops[key].compose(other.ops[key]);

        // They composed to a no-op, so delete the
        // first operation.
        if (op2 instanceof NO_OP) delete new_ops[key];
        else new_ops[key] = op2;
      }
    }

    return new APPLY(new_ops).simplify();
  }

  // No composition possible.
  return null;
};

APPLY.prototype.rebase_functions = [
  [
    APPLY,
    function (other, conflictless) {
      // Rebase the sub-operations on corresponding keys.
      // If any rebase fails, the whole rebase fails.

      // When conflictless is supplied with a prior document state,
      // the state represents the object, so before we call rebase
      // on inner operations, we have to go in a level on the prior
      // document.
      function build_conflictless(key) {
        if (!conflictless || !('document' in conflictless)) return conflictless;
        var ret = clone(conflictless);
        if (!(key in conflictless.document))
          // The key being modified isn't present yet.
          ret.document = MISSING;
        else ret.document = conflictless.document[key];
        return ret;
      }

      var new_ops_left = {};
      for (var key in this.ops) {
        new_ops_left[key] = this.ops[key];
        if (key in other.ops)
          new_ops_left[key] = new_ops_left[key].rebase(
            other.ops[key],
            build_conflictless(key),
          );
        if (new_ops_left[key] === null) return null;
      }

      var new_ops_right = {};
      for (var key in other.ops) {
        new_ops_right[key] = other.ops[key];
        if (key in this.ops)
          new_ops_right[key] = new_ops_right[key].rebase(
            this.ops[key],
            build_conflictless(key),
          );
        if (new_ops_right[key] === null) return null;
      }

      return [
        new APPLY(new_ops_left).simplify(),
        new APPLY(new_ops_right).simplify(),
      ];
    },
  ],
];

APPLY.prototype.drilldown = function (index_or_key) {
  if (typeof index_or_key == 'string' && index_or_key in this.ops)
    return this.ops[index_or_key];
  return new NO_OP();
};

exports.createRandomOp = function (doc, context) {
  // Create a random operation that could apply to doc.
  // Choose uniformly across various options.
  var ops = [];

  // Add a random key with a random value.
  ops.push(function () {
    return new PUT('k' + Math.floor(1000 * Math.random()), createRandomValue());
  });

  // Apply random operations to individual keys.
  Object.keys(doc).forEach(function (key) {
    ops.push(function () {
      return createRandomOp(doc[key], 'object');
    });
  });

  // Select randomly.
  return ops[Math.floor(Math.random() * ops.length)]();
};
