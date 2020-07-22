// Common Modules...
import * as util from 'util';
import * as deepEqual from "deep-equal";

// Own Modules...
import { Operation, MISSING } from "./index";

// Local Fields...

// Beginning of Logic!

export class NO_OP extends Operation {
  constructor() {
    super();

    this.rebase_functions = [
      Operation,
      function (other, conflictless) {
        return [this, other];
      },
    ];
  }

  inspect(depth?) {
    return "<NO_OP>";
  }

  internalToJSON(json, protocol_version) {
    return new NO_OP();
  }

  apply(document) {
    /* Applies the operation to a document. Returns the document
       unchanged. */
    return document;
  }

  simplify() {
    /* Returns a new atomic operation that is a simpler version
       of this operation.*/
    return this;
  }

  drilldown(index_or_key?) {
    return new NO_OP();
  }

  inverse(document?) {
    /* Returns a new atomic operation that is the inverse of this operation,
    given the state of the document before the operation applies. */
    return this;
  }

  atomic_compose(other?) {
    /* Creates a new atomic operation that has the same result as this
       and other applied in sequence (this first, other after). Returns
       null if no atomic operation is possible. */
    return other;
  }
  
  get_length_change(old_length?) {
    // Support routine for sequences.PATCH that returns the change in
    // length to a sequence if this operation is applied to it.
    return 0;
  }
  
  decompose(in_out?, at_index?) {
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
  }
}

export class SET extends Operation {
  private value: any;

  constructor(value) {
    super();
    this.value = value;
    
    this.rebase_functions = [
      // Rebase this against other and other against this.
      [SET, function(other, conflictless) {
        // SET and SET.
    
        // If they both set the the document to the same value, then the one
        // applied second (the one being rebased) becomes a no-op. Since the
        // two parts of the return value are for each rebased against the
        // other, both are returned as no-ops.
        if (deepEqual(this.value, other.value, { strict: true }))
          return [new NO_OP(), new NO_OP()];
    
        // If they set the document to different values and conflictless is
        // true, then we clobber the one whose value has a lower sort order.
        if (conflictless && jot.cmp(this.value, other.value) < 0)
          return [new NO_OP(), new SET(other.value)];
    
        // cmp > 0 is handled by a call to this function with the arguments
        // reversed, so we don't need to explicltly code that logic.
    
        // If conflictless is false, then we can't rebase the operations
        // because we can't preserve the meaning of both. Return null to
        // signal conflict.
        return null;
      }],
  
      [MATH, function(other, conflictless) {
        // SET (this) and MATH (other). To get a consistent effect no matter
        // which order the operations are applied in, we say the SET comes
        // second. i.e. If the SET is already applied, the MATH becomes a
        // no-op. If the MATH is already applied, the SET is applied unchanged.
        return [
          this,
          new NO_OP()
        ];
      }]
    ];
  }
  
  inspect(depth?) {
    function str(v) {
      // Render the special MISSING value from objects.js
      // not as a JSON object.
      if (v === MISSING)
        return "~";
    
      // Render any other value as a JSON string.
      return util.format("%j", v);
    }
    return util.format("<SET %s>", str(this.value));
  }
  
  internalToJSON(json, protocol_version) {
    if (this.value === MISSING)
      json.value_missing = true;
    else
      json.value = this.value;
  }
  
  internalFromJSON(json, protocol_version, op_map) {
    if (json.value_missing)
      return new SET(MISSING);
    else
      return new SET(json.value);
  }
  
  apply(document) {
    /* Applies the operation to a document. Returns the new
       value, regardless of the document. */
    return this.value;
  }
  
  simplify() {
    /* Returns a new atomic operation that is a simpler version
       of another operation. There is nothing to simplify for
       a SET. */
    return this;
  }
  
  drilldown(index_or_key) {
    // If the SET sets an array or object value, then drilling down
    // sets the inner value to the element or property value.
    if (typeof this.value == "object" && Array.isArray(this.value))
      if (Number.isInteger(index_or_key) && index_or_key < this.value.length)
        return new SET(this.value[index_or_key]);
    if (typeof this.value == "object" && !Array.isArray(this.value) && this.value !== null)
      if (typeof index_or_key == "string" && index_or_key in this.value)
        return new SET(this.value[index_or_key]);
  
    // Signal that anything that used to be an array element or
    // object property is now nonexistent.
    return new SET(MISSING);
  }
  
  inverse(document) {
    return new SET(document);
  }
  
  atomic_compose(other) {
    /* Creates a new atomic operation that has the same result as this
       and other applied in sequence (this first, other after). Returns
       null if no atomic operation is possible.
       Returns a new SET operation that simply sets the value to what
       the value would be when the two operations are composed. */
    return new SET(other.apply(this.value)).simplify();
  }
}

export class MATH extends Operation {
  private operator;
  private operand;

  constructor(operator, operand) {
    super();

    this.operator = operator;
    this.operand = operand;

    if (this.operator == "add" || this.operator == "mult") {
      if (typeof this.operand != "number")
        throw new Error("MATH[add] and MATH[mult]'s operand must be a number.");
    }

    if (
      this.operator == "and" ||
      this.operator == "or" ||
      this.operator == "xor"
    ) {
      if (!Number.isInteger(this.operand) && typeof this.operand != "boolean")
        throw new Error(
          "MATH[and] and MATH[or] and MATH[xor]'s operand must be a boolean or integer."
        );
    }

    if (this.operator == "not") {
      if (this.operand !== null)
        throw new Error("MATH[not]'s operand must be null --- it is not used.");
    }

    if (this.operator == "rot") {
      if (
        !Array.isArray(this.operand) ||
        this.operand.length != 2 ||
        !Number.isInteger(this.operand[0]) ||
        !Number.isInteger(this.operand[1])
      )
        throw new Error(
          "MATH[rot] operand must be an array with two integer elements."
        );
      if (this.operand[1] <= 1)
        throw new Error(
          "MATH[rot]'s second operand, the modulus, must be greater than one."
        );
      if (this.operand[0] >= Math.abs(this.operand[1]))
        throw new Error(
          "MATH[rot]'s first operand, the increment, must be less than its second operand, the modulus."
        );
    }
  }
  
  inspect(depth?) {
    function str(v) {
      // Render the special MISSING value from objects.js
      // not as a JSON object.
      if (v === MISSING)
        return "~";
    
      // Render any other value as a JSON string.
      return util.format("%j", v);
    }
    return util.format("<SET %s>", str(this.value));
  }
}
