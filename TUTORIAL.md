# Designing for Compression

This is a very early draft, just trying to get down my
thoughts about how a developer could intentionally
design data structures for maximizing the compression rate.

## Primer

This is all very new.

It's common to optimize your data for serialization. When we design
data structures for IPFS and Filecoin we take into consideration how many
bytes different designs will cost.

What makes designing with ZDAG so different is that it has compression
rules, and those compression rules are applied to deterministic aspects
of the structure you give it.

This means you can program the compressor with your data structure.

In fact, you can write a compression algorithm specific to your
application adjusting the structure to fit the compression
rules in ZDAG, pass the resulting structure to ZDAG for compression, and
that data is decompressed into a superset of JSON for anyone
with a ZDAG decoder.

But keep in mind, there are often bigger opportunities to reduce
the size of your data in your application code even before you
have access to advanced compression features like our VARINT_TABLE.

## Problem: Sorted datetime index.

Imagine we're building a multi-block datetime index.

Let's skip over the intermediary nodes and design what we'd
like a leaf node to look like.

The most basic one would look something like this.

```js
// CID's are numbered to point out common links
[
  [ '2020-08-27T03:19:40.0' , CID(1) ],
  /*
 118        125 0          117 0     126 // Binary
LIST        STR INDEX     LINK INDEX END_LIST
  */
  [ '2020-08-27T03:19:41.5' , CID(1) ],
  [ '2020-08-27T03:19:42.6' , CID(1) ],
  [ '2020-08-27T03:19:43.6' , CID(5) ],
  [ '2020-08-27T03:19:44.7' , CID(5) ],
  [ '2020-08-27T03:19:45.9' , CID(5) ],
  [ '2020-08-27T03:19:46.2' , CID(5) ],
  [ '2020-08-27T03:19:47.4' , CID(2) ],
  [ '2020-08-27T03:19:48.7' , CID(2) ],
  [ '2020-08-27T03:19:49.2' , CID(2) ],
  [ '2020-08-27T03:19:50.4' , CID(2) ],
  [ '2020-09-28T01:19:51.6' , CID(8) ],
  [ '2020-09-28T01:19:52.2' , CID(8) ],
  [ '2020-09-28T11:19:53.5' , CID(8) ],
  [ '2020-09-28T11:19:54.7' , CID(3) ],
  [ '2020-09-28T11:19:55.3' , CID(3) ],
  [ '2020-09-28T11:19:56.2' , CID(3) ],
  [ '2020-09-28T11:19:57.5' , CID(3) ],
  [ '2020-09-28T11:19:58.6' , CID(3) ],
  [ '2020-09-28T11:19:59.8' , CID(4) ],
  [ '2020-09-28T11:20:00.9' , CID(4) ],
  [ '2020-09-28T11:20:01.5' , CID(4) ],
  [ '2020-09-28T11:20:02.9' , CID(4) ],
  // ... and on and on for more entries over many months
  [ '2020-11-28T11:20:02.9' , CID(9) ],
  /*
 118    125  245 1        117  8       126 // Binary
LIST    STR  INDEX        LINK INDEX   END_LIST
  */
  // the total number of entries in this list is 254
]
```

Compressing this with ZDAG will already save a lot of space compared
to JSON or CBOR.

Common link prefixes will be compressed out and
duplicate links will be compressed by their VARINT_TABLE. So that's
probably close to a 50% saving (for this totally contrived example).

But since the strings never repeat we don't gain anything from the
compression table for values.

Let's change that, let's find a point in the datetime strings that are
most common and split on it so that it de-duplicates.

```js
[
  [ '2020-08-27T',  '03:19:40.0',  CID(1)      ],
  /*
 118   125  256 1   125  0         117 8       126
LIST   STR  INDEX   STR  INDEX    LINK INDEX   END_LIST
  */
]
  // ... and on and on for 244 more entries over many months
]
```

Now all of these common prefixes will de-duplicate, leading to a huge saving!

We de-duplicated a lot of common string out of the value table but we take a small cost. The
size of each entry is a little larger (3 bytes).

We take another string token (1b), and our common prefix pointer is 2 bytes
because it's a large VARINT.

The index for the example is 256. When we split the strings the VARINT_TABLE
went over 255. This means that the 1byte address space dropped from 255 to 127.
Which means we just added 128 bytes for string pointers on the smaller strings
that are now in a 2byte range in addition to the other tokens we and pointers we added.

That cost is worth the deduplication, but it did have a consequence.

Another problem is, the string we de-duplicated is rather long, which
means it sorts to the back of the compression table making references
to it a costly 2byte VARINTs.

Luckily, we can actually shed several parts of this string and still
reconstruct the date.

```js
[
  [ '20200827' , '03:19:40.0' , CID(1) ],
/*
 118   125  0       125  0       117 8       126
LIST   STR  INDEX   STR  INDEX  LINK INDEX   END_LIST
*/
]
  // ... and on and on for 244 more entries over many months
]
```

Awesome, that saved us 245 bytes across all the entries.

Now, we could write an algorithm to chunk the string on the right down.
The problem with this approach is that, at this size the penalty token for chunking
starts to matter a lot more.

On thing we can do to reduce this cost is to use a typed list.
Whenever a list is all the same type it uses a different token to open
itself so that the list becomes a single series of TABLE indexes, removing
the type byte.

Since we already have two STR (125) tokens in this structure we can
trade them for a new list open and close token.

```js
[
  [    [    '20200827', '03:19:40.0'    ]  CID(1)      ],
/*
  118  110  1            45             0  117  8      126
  LIST STR  INDEX        INDEX   END_LIST  LINK INDEX  END_LIST
       TYPED
       LIST
*/
]
  // ... and on and on for 244 more entries over many months
]
```

This is an important thing to recognize. One we have two entries in any
list we can trade it for a typed list at no cost.

This means that whenever we start chunking string or byte data
for compression we might as well just convert it to an array right away.
While it might look like it costs more it's actually the same number
of bytes.

A string/byte in an untyped list costs (1b TOKEN + VARINT_INDEX). A typed
list removes the token bytes of both entries and only costs
two tokens (OPEN and CLOSE).

Whenever you're deciding whether or not to chunk something up you
only need to ask if it's worth 1 byte plus the VARINT for each
pointer. That's the cost calculation of going from a single strings/byte
to many, 1b + VARINT for every entry.

Now we're ready to chunk this up even more, with a token cost fixed
to nothing but the table we're manipulating with our chunking
algorithm.

```js
[
  [    [    '20200827',  '03',    '19:40.0'  ]           CID(1)     ],
/*
  118  110  245 2           0     32         126            117 8       126
  LIST STR  INDEX       INDEX  INDEX         END_LIST  LINK INDEX  END_LIST
       TYPED
       LIST
*/
]
  // ... and on and on for 244 more entries over many months
]
```

Our fancy algorithm that we didn't write found that the best
saving in the table would be to chunk the hour out of the
string.

A problem an algorithm would encounter trying to optimize too much here is balancing
that savings in the de-duplication table with the cost of additional VARINTs.
Since every entry in this data structure has a similar pattern the chunking
creates large disparities in the chunk sizes found in each entry.

This means that each chunk is costing us 2 bytes for the new pointers because every new
chunk adds more entries to the table that are in the high end of the range
and the distribution of those is even across the set, so 2 bytes per chunk.

At some point the table can't be optimized any further. Since it's deterministically
sorted there's a limit to how many entries we can keep in the low cost range of the
table.

Luckily, we know a lot about this data since this is specifically a datetime
index.

```js
(new Date('2020-08-27T03:00:00')).getTime()
// 1598497200000
1598497200000 / 100000
// 15984972
```

From looking at the prior algorith we have a good indication that sections
starting with the day are a good chunking point. Since this part of the
string is for the hour, why not use an integer representing the hour portion
instead.

Now that we're using numbers that only increase, we can use DELTA compression
and chart the difference between each entry since it's only ever going
up. Furthermore, we know that the only valid increment is a full hour, which
would be 36 (since we divided the time by 100K), so we can compress down
the delta even further by dividing every DELTA after the first occurence
by 36 down to 1.

This means that each subsequent entry is +((DELTA * 36) * 100000). Congradulations,
we just wrote our own bespoke DELTA compressor.

```js
[
  [   15984972,     [
                          [      '19:40.0',  CID(1)       ],
  /*
 118  204,210,207,7 118   118    125  0      117   0      126
LIST  VARINT        LIST  LIST   STR  INDEX  LINK  INDEX  LIST_END
  */
                                 '19:41.5',  CID(1)       ],
                                 '19:42.6',  CID(1)       ],
                                 '19:43.6',  CID(5)       ],
                                 '19:44.7',  CID(5)       ],
                                 '19:45.9',  CID(5)       ],
                                 '19:46.2',  CID(5)       ],
                                 '19:47.4',  CID(2)       ],
                                 '19:48.7',  CID(2)       ],
                                 '19:49.2',  CID(2)       ],
                                 '19:50.4',  CID(2)       ],
  ],
  [  22,  /* DELTA */     [
/*
     22
     VARINT
*/
                                 '19:51.6',  CID(8)        ],
  // ... and on and on for more entries over many months
  // ... the total number of entries is 254
]
```

As you can see, this put a pretty big hole in the data structure.
That's because we dropped all of those common strings, which didn't
cost much because of de-duplication but removing that data from the
set entirely is still less expensive than leveraging the compression
table.

We're saving not just the references but the table entries for
those strings.

The first integer is quite large so it costs 4 bytes, which is
why the DELTA compression here was so important because it's
going to greatly reduce the size of subsequent bytes, likely
keeping each to just a single byte.

This is because we've written a rather good application
specific compression algoritm of our own, without much help
from ZDAG. This would also be a much more compact CBOR or JSON
representation, although ZDAG would still be smaller.

But ZDAG still has some more savings to offer.

Since the keys don't repeat and the values are all CIDs
if we use a map here it'll end up being a TYPED_MAP which
should reduce the size even more.

```js
[
  [   15984972,
                {      '19:40.0', CID(1),
/*
 118            111    1          0
LIST  VARINT    LINK   INDEX      INDEX
                TYPED
                MAP
*/
                }
/*
                0
                MAP
                CLOSE
*/
  // and on and on for 254 total entries
  ]
]
```

Not only did we reduce the typing tokens but we shed the list
open and close tokens. That's 4 bytes for every entry in the list, so
close to 1K in total across 254 entries.

Not only that, maps get DELTA compression of the key reference, so
they will remain small integers even if you greatly increase the
number of entries in the block. Given how much savings we have so far
that's probably warranted.

This is a another thing to keep in mind, DELTA compression of the map
keys give us an opportunity to cut the pointer size down. If you know
that all your string values are only going to be used for map keys
you can be pretty sure they'll stay quite small even if the
compression table for the values gets incredibly large.

But the keys are still taking up 7 bytes in the value table. Since
integers are inlined we might get a better total compression rate
if we go back to lists and use varints instead.

And if we're willing to reduce the fidelity of the index to 1
second instead of sub-second we can divide this down even further.

We can also go back to using our application's DELTA compression
technique to keep the VARINTs small.

```js
[
  [   15984972,     [
                          [     1180,           CID(1)       ],
/*
 118  204,210,207,7 118   118   224 130 72      117   0      126
LIST  VARINT        LIST  LIST  VARINT          LINK  INDEX  LIST_END
*/
                          [       1,            CID(1)       ],
// and so on
```

Ok, no more string data. That means the compression table for values
is no longer a factor and what we're looking at is all the remaining
cost we might be able to reduce.

Even with the inline VARINTs we're paying for type tokens again
for the CID. We don't have an integer map in IPLD so we don't
have typed integer maps. But, we do have typed lists in ZDAG.

Instead of using a list of every pair, we could use two lists of
equal size, the first containing the keys and the second the values.
Since the values are all the same type, we'll get a type list for
the types.


```js
[
  [   15984972,     [
                          [     1180,         1 /* and on and on */ ],
/*
 118  204,210,207,7 118   118   224 130 72    1                     126
LIST  VARINT        LIST  LIST  VARINT        VARINT                LIST_END
*/
                          [      CID(1),  CID(1) /* and on and on */ ],
/*
                          108    1        1                          0
                          LINK   INDEX    INDEX                      CLOSE
                          TYPED
                          LIST
*/
// and so on
```

There we go.

Not only do we use less tokens for the extra lists we also shave the typing tokens.
In fact, this entire structure will serialize without type tokens for anything
but lists. We can be pretty confident that this is the best way there is to
compress this data.

And we're done :)
