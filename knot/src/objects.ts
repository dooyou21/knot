// Common Modules...
import * as util from "util";
import * as shallow_clone from 'shallow-clone';

// Own Modules...
import { NO_OP, Operation, _createRandomValue, _createRandomOp } from "./index";


// Local Fields...

// Beginning of Logic!
export const MISSING = {};

export class APPLY extends Operation {
  ops;

  constructor(first, second?) {
    super();

    if (arguments.length == 1 && typeof arguments[0] == "object") {
      // Dict form.
      this.ops = first;
    } else if (arguments.length == 2 && typeof arguments[0] == "string") {
      // key & operation form.
      this.ops = {};
      this.ops[first] = second;
    } else {
      throw new Error("invalid arguments");
    }
    
    this.rebase_functions = [
      APPLY,
      function(other, conflictless) {
        // Rebase the sub-operations on corresponding keys.
        // If any rebase fails, the whole rebase fails.
  
        // When conflictless is supplied with a prior document state,
        // the state represents the object, so before we call rebase
        // on inner operations, we have to go in a level on the prior
        // document.
        function build_conflictless(key) {
          if (!conflictless || !("document" in conflictless))
            return conflictless;
          
          const ret = shallow_clone(conflictless);
          if (!(key in conflictless.document))
          // The key being modified isn't present yet.
            ret.document = MISSING;
          else
            ret.document = conflictless.document[key];
          return ret;
        }
  
        const new_ops_left = { };
        for (let key in this.ops) {
          new_ops_left[key] = this.ops[key];
          if (key in other.ops)
            new_ops_left[key] = new_ops_left[key].rebase(other.ops[key], build_conflictless(key));
          if (new_ops_left[key] === null)
            return null;
        }
  
        const new_ops_right = { };
        for (let key in other.ops) {
          new_ops_right[key] = other.ops[key];
          if (key in this.ops)
            new_ops_right[key] = new_ops_right[key].rebase(this.ops[key], build_conflictless(key));
          if (new_ops_right[key] === null)
            return null;
        }
  
        return [
          new APPLY(new_ops_left).simplify(),
          new APPLY(new_ops_right).simplify()
        ];
      }
    ];
  }

  inspect(depth?) {
    const inner = [];
    const ops = this.ops;

    Object.keys(ops).forEach(function (key) {
      inner.push(util.format("%j:%s", key, ops[key].inspect(depth - 1)));
    });

    return util.format("<APPLY %s>", inner.join(", "));
  }
  
  visit(visitor) {
    // A simple visitor paradigm. Replace this operation instance itself
    // and any operation within it with the value returned by calling
    // visitor on itself, or if the visitor returns anything falsey
    // (probably undefined) then return the operation unchanged.
    const ops: any = {};
    for (let key in this.ops)
      ops[key] = this.ops[key].visit(visitor);
  
    const ret = new APPLY(ops);
    return visitor(ret) || ret;
  }
  
  internalToJSON(json, protocol_version) {
    json.ops = { };
    for (let key in this.ops)
      json.ops[key] = this.ops[key].toJSON(undefined, protocol_version);
  }
  
  internalFromJSON(json, protocol_version, op_map) {
    const ops = { };
    for (let key in json.ops)
      ops[key] = super.opFromJSON(json.ops[key], protocol_version, op_map);
    return new APPLY(ops);
  }
  
  apply(document) {
    /* Applies the operation to a document. Returns a new object that is
       the same type as document but with the change made. */
  
    // Clone first.
    const d: any = { };
    for (let k in document)
      d[k] = document[k];
  
    // Apply. Pass the object and key down in the second argument
    // to apply so that values.SET can handle the special MISSING
    // value.
    for (let key in this.ops) {
      const value = this.ops[key].apply(d[key], [d, key]);
      if (value === MISSING)
        delete d[key]; // key was removed
      else
        d[key] = value;
    }
    return d;
  }
  
  simplify() {
    /* Returns a new atomic operation that is a simpler version
       of this operation. If there is no sub-operation that is
       not a NO_OP, then return a NO_OP. Otherwise, simplify all
       of the sub-operations. */
    const new_ops = { };
    
    let had_non_noop = false;
    for (let key in this.ops) {
      new_ops[key] = this.ops[key].simplify();
      if (!(new_ops[key] instanceof NO_OP))
      // Remember that we have a substantive operation.
        had_non_noop = true;
      else
      // Drop internal NO_OPs.
        delete new_ops[key];
    }
    if (!had_non_noop)
      return new NO_OP();
    return new APPLY(new_ops);
  }
  
  inverse(document) {
    /* Returns a new atomic operation that is the inverse of this operation,
       given the state of the document before this operation applies. */
    const new_ops = { };
    for (let key in this.ops) {
      new_ops[key] = this.ops[key].inverse(key in document ? document[key] : exports.MISSING);
    }
    return new APPLY(new_ops);
  }
  
  atomic_compose(other) {
    /* Creates a new atomic operation that has the same result as this
       and other applied in sequence (this first, other after). Returns
       null if no atomic operation is possible. */
  
    // two APPLYs
    if (other instanceof APPLY) {
      // Start with a clone of this operation's suboperations.
      const new_ops = shallow_clone(this.ops);
    
      // Now compose with other.
      for (let key in other.ops) {
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
          if (op2 instanceof NO_OP)
            delete new_ops[key];
        
          else
            new_ops[key] = op2;
        }
      }
      return new APPLY(new_ops).simplify();
    }
  
    // No composition possible.
    return null;
  }
  
  drilldown(index_or_key) {
    if (typeof index_or_key == "string" && index_or_key in this.ops)
      return this.ops[index_or_key];
    return new NO_OP();
  }
}

export class PUT extends APPLY {
  constructor(key, value) {
    super(key, value);
  }
}

export class REM extends APPLY {
  constructor(key) {
    super(key);
  }
}

export function createRandomOp(doc, context) {
  // Create a random operation that could apply to doc.
  // Choose uniformly across various options.
  const ops = [];
  
  // Add a random key with a random value.
  ops.push(function() { return new PUT("k"+Math.floor(1000*Math.random()), _createRandomValue()); });
  
  // Apply random operations to individual keys.
  Object.keys(doc).forEach(function(key) {
    ops.push(function() { return _createRandomOp(doc[key], "object") });
  });
  
  // Select randomly.
  return ops[Math.floor(Math.random() * ops.length)]();
}
