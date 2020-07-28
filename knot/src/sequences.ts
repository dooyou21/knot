// Common Modules...
import * as util from "util";
import * as shallow_clone from 'shallow-clone';
import * as deepEqual from "deep-equal";

// Own Modules...
import { NO_OP, Operation, _createRandomValue, _createRandomOp } from "./index";


// Local Fields...

// Beginning of Logic!
export class PATCH extends Operation {

  hunks;
  
  constructor(first, second) {
    super();
    
    /* An operation that replaces a subrange of the sequence with new elements. */
    if (arguments[0] === "__hmm__") return; // used for subclassing
    if (arguments.length != 1)
      throw new Error("Invaid Argument");
  
    this.hunks = first;
  
    // Sanity check & freeze hunks.
    if (!Array.isArray(this.hunks))
      throw new Error("Invaid Argument");
    this.hunks.forEach(function(hunk) {
      if (typeof hunk.offset != "number")
        throw new Error("Invalid Argument (hunk offset not a number)");
      if (hunk.offset < 0)
        throw new Error("Invalid Argument (hunk offset is negative)");
      if (typeof hunk.length != "number")
        throw new Error("Invalid Argument (hunk length is not a number)");
      if (hunk.length < 0)
        throw new Error("Invalid Argument (hunk length is negative)");
      if (!(hunk.op instanceof Operation))
        throw new Error("Invalid Argument (hunk operation is not an operation)");
      if (typeof hunk.op.get_length_change != "function")
        throw new Error("Invalid Argument (hunk operation " + hunk.op.inspect() + " does not support get_length_change)");
      if (typeof hunk.op.decompose != "function")
        throw new Error("Invalid Argument (hunk operation " + hunk.op.inspect() + " does not support decompose)");
    });
  }
  
}

export class SPLICE extends PATCH {
  constructor(pos, length, value) {
    super(pos, length, value);
  }
}

export class ATINDEX extends PATCH {
  constructor() {
    super();
    
  }
}

export class MAP extends Operation {
  
  op;
  
  constructor(op) {
    super();
  
    if (op == null) throw new Error("Invalid Argument");
    this.op = op;
  }
  
  
}
