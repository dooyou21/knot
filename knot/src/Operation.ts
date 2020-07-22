// Common Modules...

// Own Modules...
import { NO_OP, SET } from './values';
import { LIST } from './lists';

// Local Fields...

// Beginning of Logic!
export abstract class Operation {
  
  protected rebase_functions;
  
  abstract atomic_compose(other);
  abstract inspect();
  
  isNoOp() {
    return this instanceof NO_OP;
  }
  
  visit(visitor): Operation {
    // A simple visitor paradigm. Replace this operation instance itself
    // and any operation within it with the value returned by calling
    // visitor on itself, or if the visitor returns anything falsey
    // (probably undefined) then return the operation unchanged.
    return visitor(this) || this;
  }
  
  toJSON(__key__, protocol_version) {
    // The first argument __key__ is used when this function is called by
    // JSON.stringify. For reasons unclear, we get the name of the property
    // that this object is stored in in its parent? Doesn't matter. We
    // leave a slot so that this function can be correctly called by JSON.
    // stringify, but we don't use it.
    
    // The return value.
    const repr: any = {};
    
    // If protocol_version is unspecified, then this is a top-level call.
    // Choose the latest (and only) protocol version and write it into
    // the output data structure, and pass it down recursively.
    //
    // If protocol_version was specified, this is a recursive call and
    // we don't need to write it out. Sanity check it's a valid value.
    if (typeof protocol_version == "undefined") {
      protocol_version = 1;
      repr["_ver"] = protocol_version;
    } else {
      if (protocol_version !== 1)
        throw new Error("Invalid protocol version: " + protocol_version);
    }
    
    // Set the module and operation name.
    repr["_type"] = this.type[0] + "." + this.type[1];
    
    // Call the operation's toJSON function.
    this.internalToJSON(repr, protocol_version);
    
    // Return.
    return repr;
  }
  opFromJSON(obj, protocol_version?, op_map?) {
    // Sanity check.
    if (typeof obj !== "object") throw new Error("Not an operation.");
    
    // If protocol_version is unspecified, then this is a top-level call.
    // The version must be encoded in the object, and we pass it down
    // recursively.
    //
    // If protocol_version is specified, this is a recursive call and
    // we don't need to read it from the object.
    if (typeof protocol_version === "undefined") {
      protocol_version = obj["_ver"];
      if (protocol_version !== 1)
        throw new Error(
          "JOT serialized data structure is missing protocol version and one wasn't provided as an argument."
        );
    } else {
      if (protocol_version !== 1)
        throw new Error(
          "Invalid protocol version provided: " + protocol_version
        );
      if ("_ver" in obj)
        throw new Error(
          "JOT serialized data structure should not have protocol version because it was provided as an argument."
        );
    }
    
    // Create a default mapping from encoded types to constructors
    // allowing all operations to be deserialized.
    if (!op_map) {
      op_map = {};
      
      function extend_op_map(module) {
        op_map[module.module_name] = {};
        for (var key in module.op_map)
          op_map[module.module_name][key] = module.op_map[key];
      }
      
      extend_op_map(values);
      extend_op_map(sequences);
      extend_op_map(objects);
      extend_op_map(lists);
      extend_op_map(copies);
    }
    
    // Get the operation class.
    if (typeof obj["_type"] !== "string") throw new Error("Not an operation.");
    var dottedclassparts = obj._type.split(/\./g, 2);
    if (dottedclassparts.length != 2) throw new Error("Not an operation.");
    var clazz = op_map[dottedclassparts[0]][dottedclassparts[1]];
    
    // Call the deserializer function on the class.
    return clazz.internalFromJSON(obj, protocol_version, op_map);
  }
  
  serialize() {
    return JSON.stringify(this);
  }
  
  deserialize(op_json) {
    return this.opFromJSON(JSON.parse(op_json));
  }
  
  compose(other, no_list) {
    if (!(other instanceof exports.Operation))
      throw new Error("Argument must be an operation.");
    
    // A NO_OP composed with anything just gives the other thing.
    if (this instanceof NO_OP) return other;
    
    // Composing with a NO_OP does nothing.
    if (other instanceof NO_OP) return this;
    
    // Composing with a SET obliterates this operation.
    if (other instanceof SET) return other;
    
    // Attempt an atomic composition if this defines the method.
    if (this.atomic_compose) {
      var op = this.atomic_compose(other);
      if (op != null) return op;
    }
    
    if (no_list) return null;
    
    // Fall back to creating a LIST. Call simplify() to weed out
    // anything equivalent to a NO_OP.
    return new LIST([this, other]).simplify();
  }
  
  rebase(other, conflictless, debug) {
    /* Transforms this operation so that it can be composed *after* the other
       operation to yield the same logical effect as if it had been executed
       in parallel (rather than in sequence). Returns null on conflict.
       If conflictless is true, tries extra hard to resolve a conflict in a
       sensible way but possibly by killing one operation or the other.
       Returns the rebased version of this. */
  
    // Run the rebase operation in a's prototype. If a doesn't define it,
    // check b's prototype. If neither define a rebase operation, then there
    // is a conflict.
    for (let i = 0; i < ((this.rebase_functions!=null) ? this.rebase_functions.length : 0); i++) {
      if (other instanceof this.rebase_functions[i][0]) {
        var r = this.rebase_functions[i][1].call(this, other, conflictless);
        if (r != null && r[0] != null) {
          if (debug) debug("rebase", this, "on", other, (conflictless ? "conflictless" : ""), ("document" in conflictless ? JSON.stringify(conflictless.document) : ""), "=>", r[0]);
          return r[0];
        }
      }
    }
  
    // Either a didn't define a rebase function for b's data type, or else
    // it returned null above. We can try running the same logic backwards on b.
    for (let i = 0; i < ((other.rebase_functions!=null) ? other.rebase_functions.length : 0); i++) {
      if (this instanceof other.rebase_functions[i][0]) {
        const r = other.rebase_functions[i][1].call(other, this, conflictless);
        if (r != null && r[1] != null) {
          if (debug) debug("rebase", this, "on", other, (conflictless ? "conflictless" : ""), ("document" in conflictless ? JSON.stringify(conflictless.document) : ""), "=>", r[0]);
          return r[1];
        }
      }
    }
  
    // Everything can rebase against a LIST and vice versa.
    // This has higher precedence than the this instanceof SET fallback.
    if (this instanceof LIST || other instanceof LIST) {
      const ret = new LIST().rebase(other, this, conflictless, debug);
      if (debug) debug("rebase", this, "on", other, "=>", ret);
      return ret;
    }
  
    if (conflictless) {
      // Everything can rebase against a COPY in conflictless mode when
      // a previous document content is given --- the document is needed
      // to parse a JSONPointer and know whether the path components are
      // for objects or arrays. If this's operation affects a path that
      // is copied, the operation is cloned to the target path.
      // This has higher precedence than the this instanceof SET fallback.
      if (other instanceof COPY && typeof conflictless.document != "undefined")
        return other.clone_operation(this, conflictless.document);
    
      // Everything can rebase against a SET in a conflictless way.
      // Note that to resolve ties, SET rebased against SET is handled
      // in SET's rebase_functions.
    
      // The SET always wins!
      if (this instanceof SET) {
        if (debug) debug("rebase", this, "on", other, "=>", this);
        return this;
      }
      if (other instanceof SET) {
        if (debug) debug("rebase", this, "on", other, "=>", new NO_OP());
        return new NO_OP();
      }
    
      // If conflictless rebase would fail, raise an error.
      throw new Error("Rebase failed between " + this.inspect() + " and " + other.inspect() + ".");
    }
  
    return null;
  }
}

