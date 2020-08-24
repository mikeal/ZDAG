# zdag

This is an experimental block format for IPLD. It leverages the
constraints of the IPLD data model to shave as many bytes off
the block format as we can without compression.

Features:

* fully deterministic
* deduplicates (compresses) common values like strings, bytes, map keys.
* deduplicates (compresses) all links (cids)
* supports the full IPLD data model
* links can be parsed without reading the entire block
* link prefixes are de-duplicated (compressed)
* (experiment) value data compression.
  * by compressing the string/byte value and map key data separate from
    the links and structure we target only the most easily compressable
    data.
* paths can be read without fully parsing most values
* some paths can even be ruled out of being available simply by checking
  the lengths of potential map keys

## Experimental Value Compression

Constraints:

* Does not support anything not in the IPLD data model
* Blocks must be written transactionally (no streaming)
* Every serialization must be a single, complete value type

# block structure

```
links | values | structure
```

A block is broken into 3 parts and each part has different
parsing rules

```
| ...cids | null byte |
| length | ...values(len | data) |
| structure |
```

The first section is all the links (cids) and is ended by a null byte.

The second section is all the *values* (map keys, string values, byte values).
The length of this section is the first varint, so there is no closing delimiter.

The third section is the actual value type structure, which will reference
cids and string/byte values from the prior sections. Other types are written
inline into the structure.

```
// each line is an structure example
[ 0 ] // 0 int
[ 1 ] // 1 int
[ 101, 102 ] // 102 int (penalty byte due to conflict with table entries)
[ 102, reference varint ] // string
[ 103, reference varint ] // bytes
[ 108, ...(reference varint, table entry) ] // map
[ 109, ...(table entry) ] // list
```

## table

```
0 - 100 : inline varint
100 : list delimiter
101 : varint (limited allowable use)
102 : utf8 string reference
103 : bytes reference
104 : null
105 : true
106 : false
107 : float
108 : map
109 : list
110 : cid reference
111 : signed varint
112 : signed float
113 : zero point float (not implemented)
114 : typed map (not implemented)
115 : typed list (not implemented)
116+ : inline varint
```

## writing cids

* write the byte representation of every CID
* write null byte

## writing values

* pepare every value
  * recursively parse through the entire object
    * convert all string values and map keys to binary representation
    * collect all binary values
    * de-duplicate every value's binary representation
  * order all values
    * length first, then byte comparison
  * write the increase in length from the prior value (beginning at zero)
  * write the value
* write the length of the prepared values
* write the prepared values

Writing this way enforces deterministic ordering and de-duplication. It
also keeps the encoded length numbers as small as possible, leading
to a smaller varint.

## writing structure

The block stucture is written as a single table entry.

If the root block stucture is a map or list the trailing delimiter (0 for map, 100 for list)
MUST be removed.

### writing table entries

#### writing map value

* write 108
* for every entry in the list
  * write the increase over the previous map key + 1
  * write the table entry for the value
* write a null byte

Writing this way enforces deterministic order of map keys. It
also keeps the encoded index numbers as small as possible, leading
to a smaller varint.

No two map keys can reference the same value index. MUST throw.

#### writing list value

* write 109
* for every value in the list
  * write the table entry
* write 100

#### writing varints

For any whole positive

* If the number is between 100 and 112 write [ 101, varint ]
* For any other number just write the varint

For negative integers:

* write 111
* write the varint

#### writing floats

For positive floats:

* write 107
* write the mantissa length as a varint
* write the integer for the full value (float divided by Math.pow(10, mantissaLength)) as a varint

For negative floats:

* write 112
* write the mantissa length as a varint
* write the integer for the full value (float divided by Math.pow(10, mantissaLength)) as a varint

#### writing constants (null, true, false)

* if null: write 104
* if true: write 105
* if false: write 106

#### writing references (cid, string, bytes)

* if link: write 110 and then the varint index of the link
* if string: write 102 and then the varint index of the value
* if bytes: write 103 and then the varint index of the value

## parsing cids

* parse each cid until null byte

## parsing values

* first varint is the length of the entire values section
* parse each value
  * `read()` varint for increase from prior length (begins at zero)
  * value is written after the varint for the given length (prior length + increase)

## parsing structure

* structure is parsed as a single table entry value
* for map and list entries the final trailing delimiter (0 for map, 100 for list) is removed

### parsing a table entry

We use `read()` to refer to the next read after this varint is read

* < 100 - This varint is the inline number value
* 100 - List delimiter
* 101 - If it's a varint then the next `read()` is the full varint value
* 102 - The next `read()` is a varint for the index of the value and this value is a string value.
* 103 - The next `read()` is a varint for the index of the value and this value is a bytes value.
* 104 - This is null
* 105 - This is true
* 106 - This is false
* 107 - The next two `read()`s are varints parsed into a float value.
  * The first varint is the left side of the decimal value (positive or negative integer)
  * The second varint is the rigth side of the decimal value
    * This means that the decoding rules may need to vary for positive and negative floats,
      as the interpretation of this value is positive when applied to a positive float and
      negative when applied to a negative float
* 108 - All of the following `read()`s are in this `map` until a null byte
  * The first `read()` is a reference to the value index and should be represented by a string key. The index is offset by +1 so that a null byte can be used to end the map.
  * The next `read()` is the map value and is a table entry table entry
  * read these recursively until you hit a null byte
* 109 - All of the following `read()`s are in this `list` until a 100 delimiter
  * Every `read()` is a table entry you hit a 100 delimiter
* 110 - The next `read()` is a varint for the index of the cid value.
* 111 - The next `read()` is a signed varint, follow the varint parsing rules but make the value negative
* 112 - The next `read()` is a signed float, follow float parsing rules but make the left side negative
* 113 - The next `read()` is a zero point float, the next varint is the integer representing the mantissa below zero. (not implemented)
* 114 - Typed map (not implemented)
* 115 - Typed list (not implemented)
* 116+ - This varint is the inline number value

## value and cid sorting algorithm

### value sorting rules

* only the binary form is stored
* sort length first
* then sort by byte comparison

Sort:

```
[ 1, 2, 3, 4 ]
[ 1, 5, 5, 5 ]
[ 2, 0, 0, 0, 0, 0]
```

Serializes as:

```
[ 4 ] [ 1, 2, 3, 4 ]
[ 0 ] [ 1, 5, 5, 5 ]
[ 2 ] [ 2, 0, 0, 0, 0, 0]
```


### cid sorting / compression rules

The link section of the block is sorted with CID specific rules in order
to compress the links by de-duplicating common prefixes.

* All CIDv0 entries come first.
* All cid's with a digest length greater than 4 are compressed by common prefixes.
  * It's possible to have an identity multihash with a valid length below zero. These
    must be written serially ordered by length first

The sorting of CIDs:

```
[ 18 ] [ length=32 ] [ digest-1 ]
[ 18 ] [ length=32 ] [ digest-2 ]
[ 1 , codec=1, hashfn=1 ] [ length=0 ] [ ]
[ 1 , codec=1, hashfn=1 ] [ length=1 ] [ 1 ]
[ 1 , codec=1, hashfn=1 ] [ length=1 ] [ 2 ]
[ 1 , codec=1, hashfn=1 ] [ length=245 ] [ digest-1 ]
[ 1 , codec=1, hashfn=1 ] [ length=245 ] [ digest-2 ]
[ 1 , codec=1, hashfn=1 ] [ length=245 ] [ digest-3 ]
[ 1 , codec=1, hashfn=1 ] [ length=250 ] [ digest-1 ]
[ 1 , codec=1, hashfn=1 ] [ length=250 ] [ digest-2 ]
[ 1 , codec=1, hashfn=1 ] [ length=250 ] [ digest-3 ]
[ 1 , codec=2, hashfn=1 ] [ length=250 ] [ digest-1 ]
[ 1 , codec=2, hashfn=1 ] [ length=250 ] [ digest-2 ]
[ 1 , codec=2, hashfn=2 ] [ length=250 ] [ digest-1 ]
[ 1 , codec=2, hashfn=2 ] [ length=250 ] [ digest-2 ]
```

Is serialized as:

```
[ 18 ] [ length=32 ] [ digest-1 ]
       [ length=32 ] [ digest-2 ]
[ 1 , codec=1, hashfn=1 ] [ length=0 ] [ ]
[ 1 , codec=1, hashfn=1 ] [ length=1 ] [ 1 ]
[ 1 , codec=1, hashfn=1 ] [ length=1 ] [ 2 ]
[ 1 , codec=1, hashfn=1 ] [ length=245 ] [ digest-2 ]
                          [ length=245 ] [ digest-3 ]
                          [ length=250 ] [ digest-1 ]
                          [ length=250 ] [ digest-2 ]
                          [ length=250 ] [ digest-3 ]
[ 1 , codec=2, hashfn=1 ] [ length=250 ] [ digest-1 ]
                          [ length=250 ] [ digest-2 ]
[ 1 , codec=2, hashfn=2 ] [ length=250 ] [ digest-1 ]
                          [ length=250 ] [ digest-2 ]
```

## map sorting algorithm

* map keys are sorted by their string value reference number
* this means the map sorting naturally corresponds to the value sorting algorithm

# Optimizations

All optimizations are required in order to guarantee determinism.

## Inline Structure when no Links or Values

When no links or values are present the two nullbytes should be dropped. If the first
byte in the structure is less than 19 (lower will conflict with CIDv0 and other potential
future multiformats), you must prepend 101.

## Typed lists and maps (not implemented)

Any map or list that only has entries that are of the same type,
and that type is not integer, MUST use typed lists and maps. Integer typed lists
don't use this feature because it would be an extra byte.

All empty maps and lists must be typed. This is so that any schema validation can be done
without additional parsing when the list is typed to anyting but an integer.

# Examples

## Structure Examples

Note that all the following examples do not have any links or values and as such
do not have proceeding null bytes.

```js
[ 1, 2 ]

/* serializes to */

109 // list
1   // 1
2   // 2
    // omit trailing delimiter when list or map is root structure
```

```js
[ 1, [ 2, 3 ] ]

/* serializes to */

109  // list
1    // 1
109  // list
2    // 2
3    // 2
100  // end list
     // omit trailing delimiter when list or map is root structure
```

```js
[ 1, [ null ], 3 ]

/* serializes to */

109  // list
1    // 1
109  // list
104  // null
100  // end list
3    // 3
     // omit trailing delimiter when list or map is root structure
```


The following examples have values and no CIDs, which is why they begin with a null byte.

```js
{ "hello": "world" }

/* serializes to */

0                        // no links
12                       // length of values header
5                        // +5 length offset
104, 101, 108, 108, 111  // "hello"
0                        // +0 length offset
119, 111, 114, 108, 100  // "world"
108                      // map
1                        // (+1 map key offset) - 1
1                        // value index
                         // omit trailing delimiter when list or map is root structure
```

```js
[ { "hello": "world", "world": "hello" } ]

/* serializes to */

0                        // no links
12                       // length of values header
5                        // +5 length offset
104, 101, 108, 108, 111  // "hello"
0                        // +0 length offset
119, 111, 114, 108, 100  // "world"
109
108                      // map
1                        // (+1 map key offset ) + 1
1                        // value index
1                        // (+1 map key offset ) - 1
0                        // value index
0                        // map end
                         // omit trailing delimiter when list or map is root structure
```
0 - 100 : inline varint
100 : list delimiter
101 : varint (limited allowable use)
102 : utf8 string reference
103 : bytes reference
104 : null
105 : true
106 : false
107 : float
108 : map
109 : list
110 : cid reference
111 : signed varint
112 : signed float
113 : zero point float (not implemented)
114 : string typed map (not implemented)
115 : string typed list (not implemented)
116 : byte value typed map
117 : byte value type list
119 : float typed map
120 : float typed list
121 : signed varint map
122 : signed varint list
123 : signed float map
124 : signed float list
125 : empty map
126 : empty list
118+ : inline varint

Typed list

```js
[ 'x', 'y', 'z' ]

/* serializes to */

0       // no links
6       // value header length
1, 120  // +1 offset length, "x"
0, 121  // +0 offset length, "y"
0, 122  // +0 offset length, "z"
115     // string typed list
1       // value index + 1
2       // value index + 1
3       // value index + 1
        // trailing zero is ommitted during structure inlining
```
