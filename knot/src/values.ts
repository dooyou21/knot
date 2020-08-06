/*  An operational transformation library for atomic values.

	This library provides three operations: NO_OP (an operation
	that leaves the value unchanged), SET (replaces the value
	with a new value), and MATH (apply one of several mathematical
	functions to the value). These functions are generic over
	various sorts of atomic data types that they may apply to.


	new values.NO_OP()

	This operation does nothing. It is the return value of various
	functions throughout the library, e.g. when operations cancel
	out. NO_OP is conflictless: It never creates a conflict when
	rebased against or operations or when other operations are
	rebased against it.
	

	new values.SET(value)
	
	The atomic replacement of one value with another. Works for
	any data type. The SET operation supports a conflictless
	rebase with all other operations.
	

	new values.MATH(operator, operand)
	
	Applies a commutative arithmetic function to a number or boolean.
	
	"add": addition (use a negative number to decrement) (over numbers only)
	
	"mult": multiplication (use the reciprocal to divide) (over numbers only)
	
	"rot": addition followed by modulus (the operand is given
	       as a tuple of the increment and the modulus). The document
	       object must be a non-negative integer and less than the modulus.

	"and": bitwise and (over integers and booleans only)

	"or": bitwise or (over integers and booleans only)
	
	"xor": bitwise exclusive-or (over integers and booleans
	       only)

	"not": bitwise not (over integers and booleans only; the operand
	       is ignored)
	
	Note that by commutative we mean that the operation is commutative
	under composition, i.e. add(1)+add(2) == add(2)+add(1).

	The operators are also guaranteed to not change the data type of the
	document. Numbers remain numbers and booleans remain booleans.

	MATH supports a conflictless rebase with all other operations if
	prior document state is provided in the conflictless argument object.
	
	*/

import util from 'util';
import { isEqual as deepEqual } from 'lodash';
import { add_op, Operation, cmp, type_name, createRandomValue } from './index';
import { MISSING } from './objects';

//////////////////////////////////////////////////////////////////////////////

exports.module_name = 'values'; // for serialization/deserialization

export const NO_OP = function () {
  /* An operation that makes no change to the document. */
  Object.freeze(this);
};
NO_OP.prototype = Object.create(Operation.prototype); // inherit
add_op(NO_OP, exports, 'NO_OP');

export const SET = function (value) {
  /* An operation that replaces the document with a new (atomic) value. */
  this.value = value;
  Object.freeze(this);
};
SET.prototype = Object.create(Operation.prototype); // inherit
add_op(SET, exports, 'SET');

export const MATH = function (operator, operand) {
  /* An operation that applies addition, multiplication, or rotation (modulus addition)
	   to a numeric document. */
  this.operator = operator;
  this.operand = operand;

  if (this.operator == 'add' || this.operator == 'mult') {
    if (typeof this.operand != 'number')
      throw new Error("MATH[add] and MATH[mult]'s operand must be a number.");
  }

  if (
    this.operator == 'and' ||
    this.operator == 'or' ||
    this.operator == 'xor'
  ) {
    if (!Number.isInteger(this.operand) && typeof this.operand != 'boolean')
      throw new Error(
        "MATH[and] and MATH[or] and MATH[xor]'s operand must be a boolean or integer.",
      );
  }

  if (this.operator == 'not') {
    if (this.operand !== null)
      throw new Error("MATH[not]'s operand must be null --- it is not used.");
  }

  if (this.operator == 'rot') {
    if (
      !Array.isArray(this.operand) ||
      this.operand.length != 2 ||
      !Number.isInteger(this.operand[0]) ||
      !Number.isInteger(this.operand[1])
    )
      throw new Error(
        'MATH[rot] operand must be an array with two integer elements.',
      );
    if (this.operand[1] <= 1)
      throw new Error(
        "MATH[rot]'s second operand, the modulus, must be greater than one.",
      );
    if (this.operand[0] >= Math.abs(this.operand[1]))
      throw new Error(
        "MATH[rot]'s first operand, the increment, must be less than its second operand, the modulus.",
      );
  }

  Object.freeze(this);
};
MATH.prototype = Object.create(Operation.prototype); // inherit
add_op(MATH, exports, 'MATH');

//////////////////////////////////////////////////////////////////////////////

NO_OP.prototype.inspect = function (depth) {
  return '<NO_OP>';
};

NO_OP.prototype.internalToJSON = function (json, protocol_version) {
  // Nothing to set.
};

NO_OP.internalFromJSON = function (json, protocol_version, op_map) {
  return new NO_OP();
};

NO_OP.prototype.apply = function (document) {
  /* Applies the operation to a document. Returns the document
	   unchanged. */
  return document;
};

NO_OP.prototype.simplify = function () {
  /* Returns a new atomic operation that is a simpler version
	   of this operation.*/
  return this;
};

NO_OP.prototype.drilldown = function (index_or_key) {
  return new NO_OP();
};

NO_OP.prototype.inverse = function (document) {
  /* Returns a new atomic operation that is the inverse of this operation,
	given the state of the document before the operation applies. */
  return this;
};

NO_OP.prototype.atomic_compose = function (other) {
  /* Creates a new atomic operation that has the same result as this
	   and other applied in sequence (this first, other after). Returns
	   null if no atomic operation is possible. */
  return other;
};

NO_OP.prototype.rebase_functions = [
  [
    Operation,
    function (other, conflictless) {
      // NO_OP operations do not affect any other operation.
      return [this, other];
    },
  ],
];

NO_OP.prototype.get_length_change = function (old_length) {
  // Support routine for sequences.PATCH that returns the change in
  // length to a sequence if this operation is applied to it.
  return 0;
};

NO_OP.prototype.decompose = function (in_out, at_index) {
  // Support routine for when this operation is used as a hunk's
  // op in sequences.PATCH (i.e. its document is a string or array
  // sub-sequence) that returns a decomposition of the operation
  // into two operations, one that applies on the left of the
  // sequence and one on the right of the sequence, such that
  // the length of the input (if !in_out) or output (if in_out)
  // of the left operation is at_index, i.e. the split point
  // at_index is relative to the document either before (if
  // !in_out) or after (if in_out) this operation applies.
  //
  // Since NO_OP has no effect, its decomposition is trivial.
  return [this, this];
};

//////////////////////////////////////////////////////////////////////////////

SET.prototype.inspect = function (depth) {
  function str(v) {
    // Render the special MISSING value from objects.js
    // not as a JSON object.
    if (v === MISSING) return '~';

    // Render any other value as a JSON string.
    return util.format('%j', v);
  }
  return util.format('<SET %s>', str(this.value));
};

SET.prototype.internalToJSON = function (json, protocol_version) {
  if (this.value === MISSING) json.value_missing = true;
  else json.value = this.value;
};

SET.internalFromJSON = function (json, protocol_version, op_map) {
  if (json.value_missing) return new SET(MISSING);
  else return new SET(json.value);
};

SET.prototype.apply = function (document) {
  /* Applies the operation to a document. Returns the new
	   value, regardless of the document. */
  return this.value;
};

SET.prototype.simplify = function () {
  /* Returns a new atomic operation that is a simpler version
	   of another operation. There is nothing to simplify for
	   a SET. */
  return this;
};

SET.prototype.drilldown = function (index_or_key) {
  // If the SET sets an array or object value, then drilling down
  // sets the inner value to the element or property value.
  if (typeof this.value == 'object' && Array.isArray(this.value))
    if (Number.isInteger(index_or_key) && index_or_key < this.value.length)
      return new SET(this.value[index_or_key]);
  if (
    typeof this.value == 'object' &&
    !Array.isArray(this.value) &&
    this.value !== null
  )
    if (typeof index_or_key == 'string' && index_or_key in this.value)
      return new SET(this.value[index_or_key]);

  // Signal that anything that used to be an array element or
  // object property is now nonexistent.
  return new SET(MISSING);
};

SET.prototype.inverse = function (document) {
  /* Returns a new atomic operation that is the inverse of this operation,
	   given the state of the document before this operation applies. */
  return new SET(document);
};

SET.prototype.atomic_compose = function (other) {
  /* Creates a new atomic operation that has the same result as this
	   and other applied in sequence (this first, other after). Returns
	   null if no atomic operation is possible.
	   Returns a new SET operation that simply sets the value to what
	   the value would be when the two operations are composed. */
  return new SET(other.apply(this.value)).simplify();
};

SET.prototype.rebase_functions = [
  // Rebase this against other and other against this.

  [
    SET,
    function (other, conflictless) {
      // SET and SET.

      // If they both set the the document to the same value, then the one
      // applied second (the one being rebased) becomes a no-op. Since the
      // two parts of the return value are for each rebased against the
      // other, both are returned as no-ops.
      if (deepEqual(this.value, other.value)) return [new NO_OP(), new NO_OP()];

      // If they set the document to different values and conflictless is
      // true, then we clobber the one whose value has a lower sort order.
      if (conflictless && cmp(this.value, other.value) < 0)
        return [new NO_OP(), new SET(other.value)];

      // cmp > 0 is handled by a call to this function with the arguments
      // reversed, so we don't need to explicltly code that logic.

      // If conflictless is false, then we can't rebase the operations
      // because we can't preserve the meaning of both. Return null to
      // signal conflict.
      return null;
    },
  ],

  [
    MATH,
    function (other, conflictless) {
      // SET (this) and MATH (other). To get a consistent effect no matter
      // which order the operations are applied in, we say the SET comes
      // second. i.e. If the SET is already applied, the MATH becomes a
      // no-op. If the MATH is already applied, the SET is applied unchanged.
      return [this, new NO_OP()];
    },
  ],
];

SET.prototype.get_length_change = function (old_length) {
  // Support routine for sequences.PATCH that returns the change in
  // length to a sequence if this operation is applied to it.
  if (typeof this.value == 'string' || Array.isArray(this.value))
    return this.value.length - old_length;
  throw new Error('not applicable: new value is of type ' + typeof this.value);
};

SET.prototype.decompose = function (in_out, at_index) {
  // Support routine for when this operation is used as a hunk's
  // op in sequences.PATCH (i.e. its document is a string or array
  // sub-sequence) that returns a decomposition of the operation
  // into two operations, one that applies on the left of the
  // sequence and one on the right of the sequence, such that
  // the length of the input (if !in_out) or output (if in_out)
  // of the left operation is at_index, i.e. the split point
  // at_index is relative to the document either before (if
  // !in_out) or after (if in_out) this operation applies.
  if (typeof this.value != 'string' && !Array.isArray(this.value))
    throw new Error('invalid value type for call');
  if (!in_out) {
    // Decompose into a delete and a replace with the value
    // lumped on the right.
    return [
      new SET(this.value.slice(0, 0)), // create empty string or array
      this,
    ];
  } else {
    // Split the new value at the given index.
    return [
      new SET(this.value.slice(0, at_index)),
      new SET(this.value.slice(at_index)),
    ];
  }
};

//////////////////////////////////////////////////////////////////////////////

MATH.prototype.inspect = function (depth) {
  return util.format(
    '<MATH %s:%s>',
    this.operator,
    typeof this.operand == 'number' &&
      (this.operator == 'and' ||
        this.operator == 'or' ||
        this.operator == 'xor')
      ? '0x' + this.operand.toString(16)
      : util.format('%j', this.operand),
  );
};

MATH.prototype.internalToJSON = function (json, protocol_version) {
  json.operator = this.operator;
  json.operand = this.operand;
};

MATH.internalFromJSON = function (json, protocol_version, op_map) {
  return new MATH(json.operator, json.operand);
};

MATH.prototype.apply = function (document) {
  /* Applies the operation to this.operand. Applies the operator/operand
	   as a function to the document. */
  if (typeof document == 'number') {
    if (this.operator == 'add') return document + this.operand;
    if (this.operator == 'mult') return document * this.operand;
    if (Number.isInteger(document)) {
      if (this.operator == 'rot')
        return (document + this.operand[0]) % this.operand[1];
      if (this.operator == 'and') return document & this.operand;
      if (this.operator == 'or') return document | this.operand;
      if (this.operator == 'xor') return document ^ this.operand;
      if (this.operator == 'not') return ~document;
    }
    throw new Error(
      'MATH operator ' + this.operator + ' cannot apply to ' + document + '.',
    );
  } else if (typeof document == 'boolean') {
    if (this.operator == 'and') return document && this.operand;
    if (this.operator == 'or') return document || this.operand;
    if (this.operator == 'xor') return !!(Number(document) ^ this.operand); // convert arithmetic result to boolean
    if (this.operator == 'not') return !document;
    throw new Error(
      'MATH operator ' + this.operator + ' does not apply to boolean values.',
    );
  } else {
    throw new Error(
      'MATH operations only apply to number and boolean values, not ' +
        type_name(document) +
        '.',
    );
  }
};

MATH.prototype.simplify = function () {
  /* Returns a new atomic operation that is a simpler version
	   of another operation. If the operation is a degenerate case,
	   return NO_OP. */
  if (this.operator == 'add' && this.operand == 0) return new NO_OP();
  if (this.operator == 'rot' && this.operand[0] == 0) return new NO_OP();
  if (this.operator == 'mult' && this.operand == 1) return new NO_OP();
  if (this.operator == 'and' && this.operand === 0) return new SET(0);
  if (this.operator == 'and' && this.operand === false) return new SET(false);
  if (this.operator == 'or' && this.operand === 0) return new NO_OP();
  if (this.operator == 'or' && this.operand === false) return new NO_OP();
  if (this.operator == 'xor' && this.operand == 0) return new NO_OP();
  return this;
};

MATH.prototype.drilldown = function (index_or_key) {
  // MATH operations only apply to scalars, so drilling down
  // doesn't make any sense. But we can say a MATH operation
  // doesn't affect any sub-components of the value.
  return new NO_OP();
};

MATH.prototype.inverse = function (document) {
  /* Returns a new atomic operation that is the inverse of this operation,
	given the state of the document before the operation applies.
	For most of these operations the value of document doesn't
	matter. */
  if (this.operator == 'add') return new MATH('add', -this.operand);
  if (this.operator == 'rot')
    return new MATH('rot', [-this.operand[0], this.operand[1]]);
  if (this.operator == 'mult') return new MATH('mult', 1.0 / this.operand);
  if (this.operator == 'and') return new MATH('or', document & ~this.operand);
  if (this.operator == 'or') return new MATH('xor', ~document & this.operand);
  if (this.operator == 'xor') return this; // is its own inverse
  if (this.operator == 'not') return this; // is its own inverse
};

MATH.prototype.atomic_compose = function (other: { operator; operand }) {
  /* Creates a new atomic operation that has the same result as this
	   and other applied in sequence (this first, other after). Returns
	   null if no atomic operation is possible. */

  if (other instanceof MATH) {
    // two adds just add the operands
    if (this.operator == other.operator && this.operator == 'add')
      return new MATH('add', this.operand + other.operand).simplify();

    // two rots with the same modulus add the operands
    if (
      this.operator == other.operator &&
      this.operator == 'rot' &&
      this.operand[1] == other.operand[1]
    )
      return new MATH('rot', [
        this.operand[0] + other.operand[0],
        this.operand[1],
      ]).simplify();

    // two multiplications multiply the operands
    if (this.operator == other.operator && this.operator == 'mult')
      return new MATH('mult', this.operand * other.operand).simplify();

    // two and's and the operands
    if (
      this.operator == other.operator &&
      this.operator == 'and' &&
      typeof this.operand == typeof other.operand &&
      typeof this.operand == 'number'
    )
      return new MATH('and', this.operand & other.operand).simplify();
    if (
      this.operator == other.operator &&
      this.operator == 'and' &&
      typeof this.operand == typeof other.operand &&
      typeof this.operand == 'boolean'
    )
      return new MATH('and', this.operand && other.operand).simplify();

    // two or's or the operands
    if (
      this.operator == other.operator &&
      this.operator == 'or' &&
      typeof this.operand == typeof other.operand &&
      typeof this.operand == 'number'
    )
      return new MATH('or', this.operand | other.operand).simplify();
    if (
      this.operator == other.operator &&
      this.operator == 'or' &&
      typeof this.operand == typeof other.operand &&
      typeof this.operand == 'boolean'
    )
      return new MATH('or', this.operand || other.operand).simplify();

    // two xor's xor the operands
    if (
      this.operator == other.operator &&
      this.operator == 'xor' &&
      typeof this.operand == typeof other.operand &&
      typeof this.operand == 'number'
    )
      return new MATH('xor', this.operand ^ other.operand).simplify();
    if (
      this.operator == other.operator &&
      this.operator == 'xor' &&
      typeof this.operand == typeof other.operand &&
      typeof this.operand == 'boolean'
    )
      return new MATH('xor', !!(this.operand ^ other.operand)).simplify();

    // two not's cancel each other out
    if (this.operator == other.operator && this.operator == 'not')
      return new NO_OP();

    // and+or with the same operand is SET(operand)
    if (
      this.operator == 'and' &&
      other.operator == 'or' &&
      this.operand === other.operand
    )
      return new SET(this.operand);

    // or+xor with the same operand is AND(~operand)
    if (
      this.operator == 'or' &&
      other.operator == 'xor' &&
      this.operand === other.operand &&
      typeof this.operand == 'number'
    )
      return new MATH('and', ~this.operand);
    if (
      this.operator == 'or' &&
      other.operator == 'xor' &&
      this.operand === other.operand &&
      typeof this.operand == 'boolean'
    )
      return new MATH('and', !this.operand);
  }

  return null; // no composition is possible
};

MATH.prototype.rebase_functions = [
  // Rebase this against other and other against this.

  [
    MATH,
    function (other, conflictless) {
      // If this and other are MATH operations with the same operator (i.e. two
      // add's; two rot's with the same modulus), then since they are commutative
      // their order does not matter and the rebase returns each operation
      // unchanged.
      if (
        this.operator == other.operator &&
        (this.operator != 'rot' || this.operand[1] == other.operand[1])
      )
        return [this, other];

      // When two different operators ocurr simultaneously, then the order matters.
      // Since operators preserve the data type of the document, we know that both
      // orders are valid. Choose an order based on the operations: We'll put this
      // first and other second.
      if (conflictless && 'document' in conflictless) {
        if (
          cmp([this.operator, this.operand], [other.operator, other.operand]) <
          0
        ) {
          return [
            // this came second, so replace it with an operation that
            // inverts the existing other operation, then applies this,
            // then re-applies other. Although a composition of operations
            // is logically sensible, returning a LIST will cause LIST.rebase
            // to go into an infinite regress in some cases.
            new SET(this.compose(other).apply(conflictless.document)),
            //other.inverse(conflictless.document).compose(this).compose(other),

            // no need to rewrite other because it's supposed to come second
            other,
          ];
        }
      }

      // The other order is handled by the converse call handled by jot.rebase.
      return null;
    },
  ],
];

function concat2(item1, item2) {
  if (item1 instanceof String) return item1 + item2;
  return item1.concat(item2);
}

function concat3(item1, item2, item3) {
  if (item1 instanceof String) return item1 + item2 + item3;
  return item1.concat(item2).concat(item3);
}

export const createRandomOp = function (doc, context) {
  // Create a random operation that could apply to doc.
  // Choose uniformly across various options depending on
  // the data type of doc.
  var ops = [];

  // NO_OP is always a possibility.
  ops.push(function () {
    return new NO_OP();
  });

  // An identity SET is always a possibility.
  ops.push(function () {
    return new SET(doc);
  });

  // Set to another random value of a different type.
  // Can't do this in a context where changing the type is not valid,
  // i.e. when in a PATCH or MAP operation on a string.
  if (context != 'string-elem' && context != 'string')
    ops.push(function () {
      return new SET(createRandomValue());
    });

  // Clear the key, if we're in an object.
  if (context == 'object')
    ops.push(function () {
      return new SET(MISSING);
    });

  // Set to another value of the same type.
  if (typeof doc === 'boolean')
    ops.push(function () {
      return new SET(!doc);
    });
  if (typeof doc === 'number') {
    if (Number.isInteger(doc)) {
      ops.push(function () {
        return new SET(doc + Math.floor((Math.random() + 0.5) * 100));
      });
    } else {
      ops.push(function () {
        return new SET(doc * (Math.random() + 0.5));
      });
    }
  }

  if (
    (typeof doc === 'string' || Array.isArray(doc)) &&
    context != 'string-elem'
  ) {
    // Delete (if not already empty).
    if (doc.length > 0)
      ops.push(function () {
        return new SET(doc.slice(0, 0));
      });

    if (doc.length >= 1) {
      // shorten at start
      ops.push(function () {
        return new SET(
          doc.slice(Math.floor(Math.random() * (doc.length - 1)), doc.length),
        );
      });

      // shorten at end
      ops.push(function () {
        return new SET(
          doc.slice(0, Math.floor(Math.random() * (doc.length - 1))),
        );
      });
    }

    if (doc.length >= 2) {
      // shorten by on both sides
      var a = Math.floor(Math.random() * doc.length - 1);
      var b = Math.floor(Math.random() * (doc.length - a));
      ops.push(function () {
        return new SET(doc.slice(a, a + b));
      });
    }

    if (doc.length > 0) {
      // expand by copying existing elements from document

      // expand by elements at start
      ops.push(function () {
        return new SET(
          concat2(
            doc.slice(0, 1 + Math.floor(Math.random() * (doc.length - 1))),
            doc,
          ),
        );
      });
      // expand by elements at end
      ops.push(function () {
        return new SET(
          concat2(
            doc,
            doc.slice(0, 1 + Math.floor(Math.random() * (doc.length - 1))),
          ),
        );
      });
      // expand by elements on both sides
      ops.push(function () {
        return new SET(
          concat3(
            doc.slice(0, 1 + Math.floor(Math.random() * (doc.length - 1))),
            doc,
            doc.slice(0, 1 + Math.floor(Math.random() * (doc.length - 1))),
          ),
        );
      });
    } else {
      // expand by generating new elements
      if (typeof doc === 'string')
        ops.push(function () {
          return new SET((Math.random() + '').slice(2));
        });
      else if (Array.isArray(doc))
        ops.push(function () {
          return new SET(
            [null, null, null].map(function () {
              return Math.random();
            }),
          );
        });
    }
  }

  if (typeof doc === 'string') {
    // reverse
    if (doc != doc.split('').reverse().join(''))
      ops.push(function () {
        return new SET(doc.split('').reverse().join(''));
      });

    // replace with new elements of the same length
    if (doc.length > 0) {
      var newvalue = '';
      for (var i = 0; i < doc.length; i++)
        newvalue += (Math.random() + '').slice(2, 3);
      ops.push(function () {
        return new SET(newvalue);
      });
    }
  }

  // Math
  if (typeof doc === 'number') {
    if (Number.isInteger(doc)) {
      ops.push(function () {
        return new MATH('add', Math.floor(100 * (Math.random() - 0.25)));
      });
      ops.push(function () {
        return new MATH('mult', Math.floor(Math.exp(Math.random() + 0.5)));
      });
      if (doc > 1)
        ops.push(function () {
          return new MATH('rot', [1, Math.min(13, doc)]);
        });
      ops.push(function () {
        return new MATH('and', 0xf1);
      });
      ops.push(function () {
        return new MATH('or', 0xf1);
      });
      ops.push(function () {
        return new MATH('xor', 0xf1);
      });
      ops.push(function () {
        return new MATH('not', null);
      });
    } else {
      // floating point math yields inexact/inconsistent results if operation
      // order changes, so you may want to disable these in testing
      ops.push(function () {
        return new MATH('add', 100 * (Math.random() - 0.25));
      });
      ops.push(function () {
        return new MATH('mult', Math.exp(Math.random() + 0.5));
      });
    }
  }
  if (typeof doc === 'boolean') {
    ops.push(function () {
      return new MATH('and', true);
    });
    ops.push(function () {
      return new MATH('and', false);
    });
    ops.push(function () {
      return new MATH('or', true);
    });
    ops.push(function () {
      return new MATH('or', false);
    });
    ops.push(function () {
      return new MATH('xor', true);
    });
    ops.push(function () {
      return new MATH('xor', false);
    });
    ops.push(function () {
      return new MATH('not', null);
    });
  }

  // Select randomly.
  return ops[Math.floor(Math.random() * ops.length)]();
};
