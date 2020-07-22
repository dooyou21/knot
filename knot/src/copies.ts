// Common Modules...
import * as util from "util";
import * as shallow_clone from 'shallow-clone';
import * as jsonpatch from 'jsonpatch';

// Own Modules...
import { NO_OP, Operation, APPLY, LIST, SET } from "./index";

// Local Fields...
const JSONPointer = jsonpatch.JSONPointer;

function serialize_pointer(jp) {
  return (jp.path.map(function(part) { return "/" + part.replace(/~/g,'~0').replace(/\//g,'~1') })
    .join(""));
}
function parse_path(jp, document) {
  const path = [];
  
  for (let i = 0; i < jp.length; i++) {
    let p = jp.path[i];
    if (Array.isArray(document))
      p = parseInt(p)
    path.push(p);
    document = document[p];
  }
  return path;
}
function drilldown_op(jp, document, op) {
  const path = parse_path(jp, document);
  for (let i = 0; i < path.length; i++)
    op = op.drilldown(path[i]);
  return op;
}
function wrap_op_in_path(jp, document, op) {
  const path = parse_path(jp, document);
  
  let i = path.length-1;
  while (i >= 0) {
    if (typeof path[i] == "string")
      op = new APPLY(path[i], op)
    else
      op = new jot.ATINDEX(path[i], op)
    i--;
  }
  return op;
}
function make_random_path(doc) {
  let path = [];
  if (typeof doc === "string" || Array.isArray(doc)) {
    if (doc.length == 0) return path;
    const idx = Math.floor(Math.random() * doc.length);
    path.push(""+idx);
    try {
      if (Math.random() < .5 && typeof doc !== "string")
        path = path.concat(make_random_path(doc[idx]));
    } catch (e) {
      // ignore - can't create path on inner value
    }
  } else if (typeof doc === "object" && doc !== null) {
    const keys = Object.keys(doc);
    if (keys.length == 0) return path;
    const key = keys[Math.floor(Math.random() * keys.length)];
    path.push(key);
    try {
      if (Math.random() < .5)
        path = path.concat(make_random_path(doc[key]));
    } catch (e) {
      // ignore - can't create path on inner value
    }
  } else {
    throw new Error("COPY cannot apply to this document type: " + doc);
  }
  return path;
}


// Beginning of Logic!
export class COPY extends Operation {
  
  pathpairs;
  
  constructor(pathpairs) {
    super();
  
    if (!Array.isArray(pathpairs)) throw new Error("argument must be a list");
    this.pathpairs = pathpairs.map(function(pathpair) {
      if (!Array.isArray(pathpair) || pathpair.length != 2)
        throw new Error("each element in pathpairs must be an array of two string elements")
      if (pathpair[0] instanceof JSONPointer && pathpair[1] instanceof JSONPointer) {
        // for internal calls only
        return pathpair;
      } else {
        if (typeof pathpair[0] != "string" || typeof pathpair[1] != "string")
          throw new Error("each element in pathpairs must be an array of two strings")
        if (pathpair[0] == pathpair[1])
          throw new Error("can't copy a path to itself")
        return [
          new JSONPointer(pathpair[0]),
          new JSONPointer(pathpair[1])
        ]
      }
    });
  }

  inspect(depth?) {
    return util.format("<COPY %s>", this.pathpairs.map(function(pathpair) {
      return serialize_pointer(pathpair[0]) + " => " + serialize_pointer(pathpair[1]);
    }).join(", "));
  }
  
  visit(visitor) {
    // A simple visitor paradigm. Replace this operation instance itself
    // and any operation within it with the value returned by calling
    // visitor on itself, or if the visitor returns anything falsey
    // (probably undefined) then return the operation unchanged.
    return visitor(this) || this;
  }
  
  internalFromJSON(json, protocol_version, op_map) {
    return new COPY(json.pathpairs);
  }
  
  apply(document) {
    /* Applies the operation to a document.*/
    this.pathpairs.forEach(function(pathpair) {
      const val = pathpair[0].get(document);
      document = pathpair[1].replace(document, val);
    });
    return document;
  }
  
  simplify(aggressive?) {
    // Simplifies the operation. Later targets in pathpairs overwrite
    // earlier ones at the same location or a descendant of the
    // location.
    return this;
  }
  
  inverse(document) {
    // Create a SET operation for every target.
    return new LIST(this.pathpairs.map(function(pathpair) {
      return wrap_op_in_path(pathpair[1], document, new SET(pathpair[1].get(document)));
    }))
  }
  
  atomic_compose(other) {
    // Return a single COPY that combines the effect of this
    // and other. Concatenate the pathpairs lists, then
    // run simplify().
    if (other instanceof COPY)
      return new COPY(this.pathpairs.concat(other.pathpairs)).simplify();
  }
  
  rebase(base, ops, conflictless, debug) {
  
  }
  
  clone_operation(op, document) {
    // Return a list of operations that includes op and
    // also for any way that op affects a copied path,
    // then an identical operation at the target path.
    const ret = [op];
    this.pathpairs.forEach(function(pathpair) {
      const src_op = drilldown_op(pathpair[0], document, op);
      if (src_op.isNoOp()) return;
      ret.push(wrap_op_in_path(pathpair[1], document, src_op));
    });
    return new LIST(ret).simplify();
  }
  
  drilldown(index_or_key) {
    // This method is supposed to return an operation that
    // has the same effect as this but is relative to index_or_key.
    // Can we do that? If a target is at or in index_or_key,
    // then we affect that location. If source is also at or
    // in index_or_key, we can drill-down both. But if source
    // is somewhere else in the document, we can't really do
    // this.
    throw "hmm";
  }
}

export function createRandomOp(doc, context?) {
  // Create a random COPY that could apply to doc. Choose
  // a random path for a source and a target.
  const pathpairs = [];
  while (1) {
    var pp = [ serialize_pointer({ path: make_random_path(doc) }),
      serialize_pointer({ path: make_random_path(doc) }) ];
    if (pp[0] != pp[1])
      pathpairs.push(pp);
    if (Math.random() < .5)
      break;
  }
  return new COPY(pathpairs);
}