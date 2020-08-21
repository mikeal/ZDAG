import main from './index.js'
import multiformats from 'multiformats/basics'

const { encode } = main(multiformats)
const run = obj => {
  console.log(obj)
  console.log('r2d2', encode(obj).byteLength)
  console.log('json', Buffer.from(JSON.stringify(obj)).length)
}
let obj = { hello: 'world', x: 0, y: 1, z:2 }
run(obj)
obj.f = 12.12
obj = [ obj ]
run(obj)
obj.push(5)
run(obj)
obj.push(7)
run(obj)
obj.push(null)
run(obj)
obj = Object.values(obj[0])
run(obj)
