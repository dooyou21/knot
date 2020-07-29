// Common Modules...
import * as util from "util";
import * as shallow_clone from 'shallow-clone';
import * as deepEqual from "deep-equal";

// Own Modules...
import { NO_OP, Operation, _createRandomValue, _createRandomOp, SET } from "./index";


// Local Fields...
function elem(seq, pos) {
  // get an element of the sequence
  if (typeof seq == "string")
    return seq.charAt(pos);
  else // is an array
    return seq[pos];
}
function concat2(item1, item2) {
  if (item1 instanceof String)
    return item1 + item2;
  return item1.concat(item2);
}

function compose_patches(a, b) {
  // Compose two patches. We do this as if we are zipping up two sequences,
  // where the index into the (hypothetical) sequence that results *after*
  // a is applied lines up with the index into the (hypothetical) sequence
  // before b is applied.
  
  var hunks = [];
  var index = 0;
  
  function make_state(op, side) {
    return {
      index: 0,
      hunks: op.hunks.slice(), // clone
      empty: function() { return this.hunks.length == 0; },
      take: function() {
        var curend = this.end();
        var h = this.hunks.shift();
        hunks.push({
          offset: this.index + h.offset - index,
          length: h.length,
          op: h.op
        });
        this.index = curend;
        index = this.index;
      },
      skip: function() {
        this.index = this.end();
        this.hunks.shift();
      },
      start: function() {
        return this.index + this.hunks[0].offset;
      },
      end: function() {
        var h = this.hunks[0];
        var ret = this.index + h.offset + h.length;
        if (side == 0)
          ret += h.op.get_length_change(h.length);
        return ret;
      }
    }
  }
  
  var a_state = make_state(a, 0),
    b_state = make_state(b, 1);
  
  while (!a_state.empty() || !b_state.empty()) {
    // Only operations in 'a' are remaining.
    if (b_state.empty()) {
      a_state.take();
      continue;
    }
    
    // Only operations in 'b' are remaining.
    if (a_state.empty()) {
      b_state.take();
      continue;
    }
    
    // The next hunk in 'a' precedes the next hunk in 'b'.
    if (a_state.end() <= b_state.start()) {
      a_state.take();
      continue;
    }
    
    // The next hunk in 'b' precedes the next hunk in 'a'.
    if (b_state.end() <= a_state.start()) {
      b_state.take();
      continue;
    }
    
    // There's overlap.
    
    var dx_start = b_state.start() - a_state.start();
    var dx_end = b_state.end() - a_state.end();
    if (dx_start >= 0 && dx_end <= 0) {
      // 'a' wholly encompasses 'b', including the case where they
      // changed the exact same elements.
      
      // Compose a's and b's suboperations using
      // atomic_compose. If the two hunks changed the exact same
      // elements, then we can compose the two operations directly.
      var b_op = b_state.hunks[0].op;
      var dx = b_op.get_length_change(b_state.hunks[0].length);
      if (dx_start != 0 || dx_end != 0) {
        // If a starts before b, wrap b_op in a PATCH operation
        // so that they can be considered to start at the same
        // location.
        b_op = new exports.PATCH([{ offset: dx_start, length: b_state.hunks[0].length, op: b_op }]);
      }
      
      // Try an atomic composition.
      var ab = a_state.hunks[0].op.atomic_compose(b_op);
      if (!ab && dx_start == 0 && dx_end == 0 && b_op instanceof exports.MAP && b_op.op instanceof values.SET)
        ab = b_op;
      
      if (ab) {
        // Replace the 'a' operation with itself composed with b's operation.
        // Don't take it yet because there could be more coming on b's
        // side that is within the range of 'a'.
        a_state.hunks[0] = {
          offset: a_state.hunks[0].offset,
          length: a_state.hunks[0].length,
          op: ab
        };
        
        // Since the a_state hunks have been rewritten, the indexing needs
        // to be adjusted.
        b_state.index += dx;
        
        // Drop b.
        b_state.skip();
        continue;
      }
      
      // If no atomic composition is possible, another case may work below
      // by decomposing the operations.
    }
    
    // There is some sort of other overlap. We can handle this by attempting
    // to decompose the operations.
    if (dx_start > 0) {
      // 'a' begins first. Attempt to decompose it into two operations.
      // Indexing of dx_start is based on the value *after* 'a' applies,
      // so we have to decompose it based on new-value indexes.
      var decomp = a_state.hunks[0].op.decompose(true, dx_start);
      
      // But we need to know the length of the original hunk so that
      // the operation causes its final length to be dx_start.
      var alen0;
      if (a_state.hunks[0].op.get_length_change(a_state.hunks[0].length) == 0)
      // This is probably a MAP. If the hunk's length is dx_start
      // and the operation causes no length change, then that's
      // the right length!
        alen0 = dx_start;
      else
        return null;
      
      // Take the left part of the decomposition.
      hunks.push({
        offset: a_state.index + a_state.hunks[0].offset - index,
        length: alen0,
        op: decomp[0]
      });
      a_state.index = a_state.start() + dx_start;
      index = a_state.index;
      
      // Return the right part of the decomposition to the hunks array.
      a_state.hunks[0] = {
        offset: 0,
        length: a_state.hunks[0].length - alen0,
        op: decomp[1]
      };
      continue;
    }
    
    if (dx_start < 0) {
      // 'b' begins first. Attempt to decompose it into two operations.
      var decomp = b_state.hunks[0].op.decompose(false, -dx_start);
      
      // Take the left part of the decomposition.
      hunks.push({
        offset: b_state.index + b_state.hunks[0].offset - index,
        length: (-dx_start),
        op: decomp[0]
      });
      b_state.index = b_state.start() + (-dx_start);
      index = b_state.index;
      
      // Return the right part of the decomposition to the hunks array.
      b_state.hunks[0] = {
        offset: 0,
        length: b_state.hunks[0].length - (-dx_start),
        op: decomp[1]
      };
      continue;
    }
    
    // The two hunks start at the same location but have different
    // lengths.
    if (dx_end > 0) {
      // 'b' wholly encompasses 'a'.
      if (b_state.hunks[0].op instanceof values.SET) {
        // 'b' is replacing everything 'a' touched with
        // new elements, so the changes in 'a' can be
        // dropped. But b's length has to be updated
        // if 'a' changed the length of its subsequence.
        var dx = a_state.hunks[0].op.get_length_change(a_state.hunks[0].length);
        b_state.hunks[0] = {
          offset: b_state.hunks[0].offset,
          length: b_state.hunks[0].length - dx,
          op: b_state.hunks[0].op
        };
        a_state.skip();
        a_state.index -= dx;
        continue;
      }
    }
    
    // TODO.
    
    // There is no atomic composition.
    return null;
  }
  
  return new exports.PATCH(hunks).simplify();
}

function rebase_patches(a, b, conflictless) {
  // Rebasing two PATCHes works like compose, except that we are aligning
  // 'a' and 'b' both on the state of the document before each has applied.
  //
  // We do this as if we are zipping up two sequences, where the index into
  // the (hypothetical) sequence, before either operation applies, lines
  // up across the two operations.
  
  function make_state(op) {
    return {
      old_index: 0,
      old_hunks: op.hunks.slice(),
      dx_index: 0,
      new_hunks: [],
      empty: function() { return this.old_hunks.length == 0; },
      take: function(other, hold_dx_index) {
        var h = this.old_hunks.shift();
        this.new_hunks.push({
          offset: h.offset + this.dx_index,
          length: h.length+(h.dlength||0),
          op: h.op
        });
        this.dx_index = 0;
        this.old_index += h.offset + h.length;
        if (!hold_dx_index) other.dx_index += h.op.get_length_change(h.length);
      },
      skip: function() {
        this.old_index = this.end();
        this.old_hunks.shift();
      },
      start: function() {
        return this.old_index + this.old_hunks[0].offset;
      },
      end: function() {
        var h = this.old_hunks[0];
        return this.old_index + h.offset + h.length;
      }
    }
  }
  
  var a_state = make_state(a),
    b_state = make_state(b);
  
  while (!a_state.empty() || !b_state.empty()) {
    // Only operations in 'a' are remaining.
    if (b_state.empty()) {
      a_state.take(b_state);
      continue;
    }
    
    // Only operations in 'b' are remaining.
    if (a_state.empty()) {
      b_state.take(a_state);
      continue;
    }
    
    // Two insertions at the same location.
    if (a_state.start() == b_state.start()
      && a_state.old_hunks[0].length == 0
      && b_state.old_hunks[0].length == 0) {
      
      // This is a conflict because we don't know which side
      // gets inserted first.
      if (!conflictless)
        return null;
      
      // Or we can resolve the conflict.
      if (jot.cmp(a_state.old_hunks[0].op, b_state.old_hunks[0].op) == 0) {
        // If the inserted values are identical, we can't make a decision
        // about which goes first, so we only take one. Which one we take
        // doesn't matter because the document comes out the same either way.
        // This logic is actually required to get complex merges to work.
        b_state.take(b_state);
        a_state.skip();
      } else if (jot.cmp(a_state.old_hunks[0].op, b_state.old_hunks[0].op) < 0) {
        a_state.take(b_state);
      } else {
        b_state.take(a_state);
      }
      continue;
    }
    
    
    // The next hunk in 'a' precedes the next hunk in 'b'.
    // Take 'a' and adjust b's next offset.
    if (a_state.end() <= b_state.start()) {
      a_state.take(b_state);
      continue;
    }
    
    // The next hunk in 'b' precedes the next hunk in 'a'.
    // Take 'b' and adjust a's next offset.
    if (b_state.end() <= a_state.start()) {
      b_state.take(a_state);
      continue;
    }
    
    // There's overlap.
    
    var dx_start = b_state.start() - a_state.start();
    var dx_end = b_state.end() - a_state.end();
    
    // They both affected the exact same region, so just rebase the
    // inner operations and update lengths.
    if (dx_start == 0 && dx_end == 0) {
      // When conflictless is supplied with a prior document state,
      // the state represents the sequence, so we have to dig into
      // it and pass an inner value
      var conflictless2 = !conflictless ? null : shallow_clone(conflictless);
      if (conflictless2 && "document" in conflictless2)
        conflictless2.document = conflictless2.document.slice(a_state.start(), a_state.end());
      
      var ar = a_state.old_hunks[0].op.rebase(b_state.old_hunks[0].op, conflictless2);
      var br = b_state.old_hunks[0].op.rebase(a_state.old_hunks[0].op, conflictless2);
      if (ar == null || br == null)
        return null;
      
      a_state.old_hunks[0] = {
        offset: a_state.old_hunks[0].offset,
        length: a_state.old_hunks[0].length,
        dlength: b_state.old_hunks[0].op.get_length_change(b_state.old_hunks[0].length),
        op: ar
      }
      b_state.old_hunks[0] = {
        offset: b_state.old_hunks[0].offset,
        length: b_state.old_hunks[0].length,
        dlength: a_state.old_hunks[0].op.get_length_change(a_state.old_hunks[0].length),
        op: br
      }
      a_state.take(b_state, true);
      b_state.take(a_state, true);
      continue;
    }
    
    // Other overlaps generate conflicts.
    if (!conflictless)
      return null;
    
    // Decompose whichever one starts first into two operations.
    if (dx_start > 0) {
      // a starts first.
      var hunk = a_state.old_hunks.shift();
      var decomp = hunk.op.decompose(false, dx_start);
      
      // Unshift the right half of the decomposition.
      a_state.old_hunks.unshift({
        offset: 0,
        length: hunk.length-dx_start,
        op: decomp[1]
      });
      
      // Unshift the left half of the decomposition.
      a_state.old_hunks.unshift({
        offset: hunk.offset,
        length: dx_start,
        op: decomp[0]
      });
      
      // Since we know the left half occurs first, take it.
      a_state.take(b_state)
      
      // Start the iteration over -- we should end up at the block
      // for two hunks that modify the exact same range.
      continue;
      
    } else if (dx_start < 0) {
      // b starts first.
      var hunk = b_state.old_hunks.shift();
      var decomp = hunk.op.decompose(false, -dx_start);
      
      // Unshift the right half of the decomposition.
      b_state.old_hunks.unshift({
        offset: 0,
        length: hunk.length+dx_start,
        op: decomp[1]
      });
      
      // Unshift the left half of the decomposition.
      b_state.old_hunks.unshift({
        offset: hunk.offset,
        length: -dx_start,
        op: decomp[0]
      });
      
      // Since we know the left half occurs first, take it.
      b_state.take(a_state)
      
      // Start the iteration over -- we should end up at the block
      // for two hunks that modify the exact same range.
      continue;
    }
    
    // They start at the same point, but don't end at the same
    // point. Decompose the longer one.
    else if (dx_end < 0) {
      // a is longer.
      var hunk = a_state.old_hunks.shift();
      var decomp = hunk.op.decompose(false, hunk.length+dx_end);
      
      // Unshift the right half of the decomposition.
      a_state.old_hunks.unshift({
        offset: 0,
        length: -dx_end,
        op: decomp[1]
      });
      
      // Unshift the left half of the decomposition.
      a_state.old_hunks.unshift({
        offset: hunk.offset,
        length: hunk.length+dx_end,
        op: decomp[0]
      });
      
      // Start the iteration over -- we should end up at the block
      // for two hunks that modify the exact same range.
      continue;
    } else if (dx_end > 0) {
      // b is longer.
      var hunk = b_state.old_hunks.shift();
      var decomp = hunk.op.decompose(false, hunk.length-dx_end);
      
      // Unshift the right half of the decomposition.
      b_state.old_hunks.unshift({
        offset: 0,
        length: dx_end,
        op: decomp[1]
      });
      
      // Unshift the left half of the decomposition.
      b_state.old_hunks.unshift({
        offset: hunk.offset,
        length: hunk.length-dx_end,
        op: decomp[0]
      });
      
      // Start the iteration over -- we should end up at the block
      // for two hunks that modify the exact same range.
      continue;
    }
    
    throw new Error("We thought this line was not reachable.");
  }
  
  return [
    new exports.PATCH(a_state.new_hunks).simplify(),
    new exports.PATCH(b_state.new_hunks).simplify() ];
}



// Beginning of Logic!
export class PATCH extends Operation {

  static rebase_functions = [
    /* Transforms this operation so that it can be composed *after* the other
       operation to yield the same logical effect. Returns null on conflict. */
    [PATCH, function(other, conflictless) {
      // Return the new operations.
      return rebase_patches(this, other, conflictless);
    }]
  ];
  
  hunks;
  
  constructor(first) {
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
  
  inspect(depth) {
    return util.format("<PATCH%s>", this.hunks.map((hunk) => {
      if ((hunk.length == 1) && (hunk.op instanceof exports.MAP))
      // special format
        return util.format(" +%d %s",
          hunk.offset,
          hunk.op.op.inspect(depth-1));
  
      return util.format(" +%dx%d %s",
        hunk.offset,
        hunk.length,
        hunk.op instanceof values.SET
          ? util.format("%j", hunk.op.value)
          : hunk.op.inspect(depth-1));
    }).join(','));
  }
  
  visit(visitor) {
    const ret = new PATCH(this.hunks.map((hunk) => {
      const r = shallow_clone(hunk);
      r.op = r.op.visit(visitor);
      return r;
    }));
    return visitor(ret) || ret;
  }
  
  internalToJSON(json, protocol_version) {
    json.hunks = this.hunks.map((hunk) => {
      const ret = shallow_clone(hunk);
      ret.op = ret.op.toJSON(undefined, protocol_version);
      return ret;
    });
  }
  
  internalFromJSON(json, protocol_version, op_map) {
    const hunks = json.hunks.map((hunk) => {
      const ret = shallow_clone(hunk);
      ret.op = this.opFromJSON(hunk.op, protocol_version, op_map);
      return ret;
    });
    return new PATCH(hunks);
  }
  
  apply(document) {
    /* Applies the operation to a document. Returns a new sequence that is
       the same type as document but with the hunks applied. */
  
    let index = 0;
    let ret = document.slice(0,0); // start with an empty document
  
    this.hunks.forEach((hunk) => {
      if (index + hunk.offset + hunk.length > document.length)
        throw new Error("offset past end of document");
    
      // Append unchanged content before this hunk.
      ret = concat2(ret, document.slice(index, index+hunk.offset));
      index += hunk.offset;
    
      // Append new content.
      var new_value = hunk.op.apply(document.slice(index, index+hunk.length));
    
      if (typeof document == "string" && typeof new_value != "string")
        throw new Error("operation yielded invalid substring");
      if (Array.isArray(document) && !Array.isArray(new_value))
        throw new Error("operation yielded invalid subarray");
    
      ret = concat2(ret, new_value);
    
      // Advance counter.
      index += hunk.length;
    });
  
    // Append unchanged content after the last hunk.
    ret = concat2(ret, document.slice(index));
  
    return ret;
  }
  
  simplify() {
    /* Returns a new atomic operation that is a simpler version
       of this operation.*/
  
    // Simplify the hunks by removing any that don't make changes.
    // Adjust offsets.
  
    // Some of the composition methods require knowing if these operations
    // are operating on a string or an array. We might not know if the PATCH
    // only has sub-operations where we can't tell, like a MAP.
    let doctype = null;
    this.hunks.forEach((hunk) => {
      if (hunk.op instanceof SET) {
        if (typeof hunk.op.value == "string")
          doctype = "string";
        else if (Array.isArray(hunk.op.value))
          doctype = "array";
      }
    });
  
    // Form a new set of merged hunks.
    const hunks = [];
    let doffset = 0;
  
    function handle_hunk(hunk) {
      const op = hunk.op.simplify();
      if (op.isNoOp()) {
        // Drop it, but adjust future offsets.
        doffset += hunk.offset + hunk.length;
        return;
  
      } else if (hunk.length == 0 && hunk.op.get_length_change(hunk.length) == 0) {
        // The hunk does nothing. Drop it, but adjust future offsets.
        doffset += hunk.offset;
        return;
  
      } else if (hunks.length > 0
        && hunk.offset == 0
        && doffset == 0
      ) {
  
        // The hunks are adjacent. We can combine them
        // if one of the operations is a SET and the other
        // is a SET or a MAP containing a SET.
        // We can't combine two adjancent MAP->SET's because
        // we wouldn't know whether the combined value (in
        // a SET) should be a string or an array.
        if ((hunks[hunks.length-1].op instanceof SET
          || (hunks[hunks.length-1].op instanceof exports.MAP && hunks[hunks.length-1].op.op instanceof SET))
          && (hunk.op instanceof SET ||
            (hunk.op instanceof exports.MAP && hunk.op.op instanceof SET) )
          && doctype != null) {
    
          function get_value(hunk) {
            if (hunk.op instanceof SET) {
              // The value is just the SET's value.
              return hunk.op.value;
            } else {
              // The value is a sequence of the hunk's length
              // where each element is the value of the inner
              // SET's value.
              let value = [];
              for (var i = 0; i < hunk.length; i++)
                value.push(hunk.op.op.value);
        
              // If the outer value is a string, reform it as
              // a string.
              if (doctype == "string")
                value = value.join("");
              return value;
            }
          }
    
          hunks[hunks.length-1] = {
            offset: hunks[hunks.length-1].offset,
            length: hunks[hunks.length-1].length + hunk.length,
            op: new SET(
              concat2(
                get_value(hunks[hunks.length-1]),
                get_value(hunk))
            )
          };
    
          return;
        }
  
      }
  
      // Preserve but adjust offset.
      hunks.push({
        offset: hunk.offset+doffset,
        length: hunk.length,
        op: op
      });
      doffset = 0;
    }
  
    this.hunks.forEach(handle_hunk);
    if (hunks.length == 0)
      return new NO_OP();
  
    return new PATCH(hunks);
  }
  
  drilldown(index_or_key) {
    if (!Number.isInteger(index_or_key) || index_or_key < 0)
      return new NO_OP();
    let index = 0;
    let ret = null;
    
    this.hunks.forEach((hunk) => {
      index += hunk.offset;
      if (index <= index_or_key && index_or_key < index+hunk.length)
        ret = hunk.op.drilldown(index_or_key-index);
      index += hunk.length;
    })
    return ret ? ret : new NO_OP();
  }
  
  inverse(document) {
    /* Returns a new atomic operation that is the inverse of this operation,
       given the state of the document before this operation applies.
       The inverse simply inverts the operations on the hunks, but the
       lengths have to be fixed. */
    let offset = 0;
    return new PATCH(this.hunks.map(function(hunk) {
      const newhunk = {
        offset: hunk.offset,
        length: hunk.length + hunk.op.get_length_change(hunk.length),
        op: hunk.op.inverse(document.slice(offset+hunk.offset, offset+hunk.offset+hunk.length))
      }
      offset += hunk.offset + hunk.length;
      return newhunk;
    }));
  }
  
  atomic_compose(other) {
    /* Creates a new atomic operation that has the same result as this
       and other applied in sequence (this first, other after). Returns
       null if no atomic operation is possible. */
  
    // a PATCH composes with a PATCH
    if (other instanceof exports.PATCH)
      return compose_patches(this, other);
  
    // No composition possible.
    return null;
  }
  
  get_length_change(old_length) {
    // Support routine for PATCH that returns the change in
    // length to a sequence if this operation is applied to it.
    let dlen = 0;
    this.hunks.forEach(function(hunk) {
      dlen += hunk.op.get_length_change(hunk.length);
    });
    return dlen;
  }
}

export class SPLICE extends PATCH {
  constructor(pos, length, value) {
    super([{
      offset: pos,
      length,
      op: new SET(value),
    }]);
  }
}

export class ATINDEX extends PATCH {
  constructor(indexes, op) {
    let offset = 0;
    super(indexes.map((index, i) => {
      const hunk = {
        offset: index - (offset + i),
        length: 1,
        op: new MAP({
          [indexes[0]]: op,
        }),
      };
      offset = index + 1;
      return hunk;
    }));
    
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
