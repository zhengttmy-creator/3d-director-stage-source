import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import * as THREE from 'three';

const require=createRequire(import.meta.url);
const bundle={window:{}};
vm.runInNewContext(await fs.readFile(new URL('../web/vendor/modules.js',import.meta.url),'utf8'),bundle);
const source=bundle.window.directorFactories['53401'].toString();
const ast=require('@babel/parser').parse('('+source+')');
const jsx=(type,props,key)=>({type,props:props||{},key});
const context=vm.createContext({crypto:{randomUUID},structuredClone,Map,Set,WeakMap,
  i:{jsx,jsxs:jsx,Fragment:'fragment'},
  so:{Pq0:THREE.Vector3,PTz:THREE.Quaternion,O9p:THREE.Euler,cj9:THREE.MathUtils},
  s9:'__director_stage_custom_pose__',ap:'path-traversal'});
require('@babel/traverse').default(ast,{
  FunctionDeclaration(path){vm.runInContext(source.slice(path.node.start-1,path.node.end-1),context)},
});
assert.equal(typeof context.__localMoveBoneKey,'function','Build the skeletal marker dragging patch first');
const plain=value=>JSON.parse(JSON.stringify(value));
const pose=angle=>({signature:'drag-fixture',rootTranslation:{x:angle/10,y:0,z:0},rotations:[
  {boneIndex:0,rotation:{x:0,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
  {boneIndex:1,rotation:{x:angle,y:0,z:0},bindWorldRotation:{x:0,y:0,z:0,w:1}},
]});
const key=(id,timeSec,angle)=>({id,timeSec,pose:pose(angle)});
const keys=[key('anchor',0,0),key('middle',1,30),key('last',2,60)];
const original=plain(keys);
const move=(id,time,duration=3,anchor)=>context.__localMoveBoneKey(keys,id,time,duration,30,anchor);
const shifted=move('middle',1.517);
assert.equal(shifted.find(item=>item.id==='middle').timeSec,46/30,'Drag time snaps to a timeline frame');
assert.equal(shifted.find(item=>item.id==='middle').pose,keys[1].pose,'Moving a key preserves its pose identity');
assert.equal(shifted[0],keys[0]);
assert.equal(shifted[2],keys[2]);
assert.deepEqual(plain(keys),original,'Moving a marker cannot mutate the baseline array');
assert.equal(move('middle',2),keys,'An occupied target frame cannot silently replace a different pose');
assert.equal(move('middle',1+1e-8),keys,'Same-frame motion is a no-op');
assert.equal(move('missing',1.5),keys,'Stale key IDs cannot create keys');
assert.equal(move('middle',Number.NaN),keys,'Invalid pointer time cannot corrupt key data');
assert.equal(move('middle',Number.POSITIVE_INFINITY),keys);
assert.equal(move('anchor',1.5,3,'anchor').find(item=>item.id==='anchor').timeSec,1.5,
  'The selected continuation anchor can move without moving the other keys');
assert.equal(move('middle',-3,3,'anchor'),keys,'An occupied start frame still rejects a collision');
assert.equal(move('last',100).find(item=>item.id==='last').timeSec,3,'Keys stop at the clip end');
assert.equal(move('anchor',-100),keys,'An ordinary key already at zero cannot move before the clip');
const reordered=move('last',0.5);
assert.deepEqual(Array.from(reordered,item=>item.id),['anchor','last','middle'],'Crossing a key sorts by time and preserves IDs');

const clip={id:'saved',objectId:'person',motionId:'motion',motionName:'Saved action',source:'imported',
  startTimeSec:3,offsetTimeSec:1,durationSec:3,speed:2,loop:false,transitionInFrames:0,
  createdAt:'2026-09-23T00:00:00Z',locomotionMode:'embedded',motionUsage:'direct',
  boneKeyframes:[key('a',1,0),key('b',3,30),key('c',5,60)],boneTiming:{offsetTimeSec:0,speed:1}};
function editorFixture({active=false,draft=false,continuation=false,clipOverride={}}={}){
  let state={objects:[{id:'person',rigged:true}],selectedObjectIds:['person'],mode:'pose',
    timeline:{displayFps:30,durationSec:12,clips:draft?[]:[structuredClone({...clip,...clipOverride})]}};
  let editing=active?{boneAnimation:true,objectId:'person',clipId:draft?undefined:'saved',
    draftClip:draft?{...structuredClone(clip),id:'draft'}:undefined,startTimeSec:3,durationSec:3,
    displayName:'Editing action',keyTimeSec:1,boneKeys:structuredClone(keys),baselinePose:pose(0),
    jointTransforms:{},lockedJointIds:[],boneDirty:false,
    ...(continuation?{poseContinuation:{anchorKeyId:'anchor',transitionFrames:8}}:{})}:null;
  const refs=[],seeks=[],notices=[],commits=[];
  const render=()=>{
    let cursor=0;
    context.n={useRef:initial=>refs[cursor++]??(refs[cursor-1]={current:initial}),useEffect:()=>{}};
    return context.__localUseBoneEditing({state,session:editing,setSession:value=>{editing=typeof value==='function'?value(editing):value},
      controller:{current:{copyPose:()=>pose(30),captureEvaluatedPerformanceFrame:async value=>({
        skeletalPoses:{person:context.__localNormalizeBonePose(value.motionPoses.person.sample)},jointTransforms:{},
      })}},sampleFrame:frame=>({frame,motionPoses:{person:{kind:'single',sample:pose(0)}}}),
      seek:value=>seeks.push(value),stop:()=>{},select:()=>{},commit:(update,reason)=>{const before=state;state=update(state);commits.push({before,after:state,reason})},
      finish:()=>{editing=null},notice:value=>notices.push(value),scope:'drag-fixture'});
  };
  return{render,get state(){return state},get session(){return editing},get id(){return editing?.draftClip?.id||'saved'},seeks,notices,commits};
}

const saved=editorFixture(),before=plain(saved.state.timeline);
assert.equal(typeof saved.render().moveKey,'function','The real editing hook exposes marker timing edits');
await saved.render().moveKey('saved','b',1.5);
assert.equal(saved.commits.length,1,'A saved marker drag produces one undoable commit');
assert.equal(saved.state.timeline.clips[0].boneKeyframes.find(item=>item.id==='b').timeSec,4,
  'Displayed time maps back through the imported clip offset and speed');
assert.equal(context.__localBoneDisplayKeys(saved.state.timeline.clips[0]).find(item=>item.id==='b').timeSec,1.5);
assert.equal(saved.state.timeline.clips[0].startTimeSec,3,'A key drag cannot move the action strip');
assert.equal(saved.state.timeline.clips[0].durationSec,3,'A key drag cannot resize the action strip');
assert.equal(saved.session,null,'Moving a saved key does not start an unrelated edit transaction');
assert.deepEqual(plain(saved.commits[0].before.timeline),before,'The commit retains the complete undo baseline');
await saved.render().moveKey('saved','b',2);
assert.equal(saved.commits.length,1,'Collision with a different saved key cannot commit data loss');

for(const scenario of [
  {name:'negative source time with a hidden trailing key',keyId:'a',timeSec:1,clipOverride:{
    offsetTimeSec:1,speed:1,boneTiming:{offsetTimeSec:3,speed:1},
    boneKeyframes:[key('a',0,0),key('b',1,30),key('c',3,60)]}},
  {name:'source time beyond 30 seconds with a hidden leading key',keyId:'b',timeSec:2.8,clipOverride:{
    offsetTimeSec:25,speed:4,boneTiming:{offsetTimeSec:0,speed:1},
    boneKeyframes:[key('a',0,0),key('b',26,30),key('c',28,60)]}},
  {name:'a hidden key beyond 30 display seconds needs a scaled time basis',keyId:'a',timeSec:1,clipOverride:{
    offsetTimeSec:0,speed:0.25,boneTiming:{offsetTimeSec:1,speed:1},
    boneKeyframes:[key('a',0,0),key('b',0.25,30),key('c',30,60)]}},
]){
  const item=editorFixture({clipOverride:scenario.clipOverride});
  const prior=item.state.timeline.clips[0];
  const originalDisplayed=context.__localBoneDisplayKeys(prior);
  await item.render().moveKey('saved',scenario.keyId,scenario.timeSec);
  assert.equal(item.commits.length,1,scenario.name+' commits once');
  const updated=item.state.timeline.clips[0],normalized=context.__localBoneClipData(updated);
  assert.equal(normalized.boneKeyframes.length,prior.boneKeyframes.length,
    scenario.name+' survives stage normalization without losing a key');
  assert.ok(normalized.boneKeyframes.every(key=>key.timeSec>=0&&key.timeSec<=30),
    scenario.name+' persists legal source times');
  const displayed=context.__localBoneDisplayKeys({...updated,...normalized});
  for(const previous of originalDisplayed){
    const actual=displayed.find(key=>key.id===previous.id);
    assert.ok(actual,scenario.name+' preserves hidden and visible IDs');
    const expected=previous.id===scenario.keyId?scenario.timeSec:previous.timeSec;
    assert.ok(Math.abs(actual.timeSec-expected)<1e-6,
      scenario.name+' preserves displayed time for '+previous.id+': '+actual.timeSec+' vs '+expected);
    assert.deepEqual(plain(actual.pose),plain(previous.pose),scenario.name+' preserves every pose');
  }
  assert.equal(updated.startTimeSec,prior.startTimeSec);
  assert.equal(updated.durationSec,prior.durationSec);
}

for(const draft of [false,true]){
  const item=editorFixture({active:true,draft}),baseline=plain(item.state.timeline);
  await item.render().moveKey(item.id,'middle',1.5);
  assert.equal(item.session.boneKeys.find(value=>value.id==='middle').timeSec,1.5);
  assert.equal(item.session.boneKeys.find(value=>value.id==='middle').pose.rotations[1].rotation.x,30);
  assert.equal(item.session.keyTimeSec,1.5,'The editor follows the moved key');
  assert.equal(item.seeks.at(-1),4.5,'The seek uses global clip time');
  assert.equal(item.commits.length,0,'An active draft stays in its existing save/cancel transaction');
  assert.deepEqual(plain(item.state.timeline),baseline,'Dragging unsaved keys cannot modify the saved document');
  await item.render().moveKey(item.id,'middle',2);
  assert.equal(item.session.boneKeys.find(value=>value.id==='middle').timeSec,1.5,'Session collisions preserve the last accepted key');
}
const continuation=editorFixture({active:true,continuation:true});
await continuation.render().moveKey('saved','anchor',1.5);
assert.equal(continuation.session.boneKeys.find(item=>item.id==='anchor').timeSec,1.5);
assert.deepEqual(continuation.session.boneKeys.filter(item=>item.id!=='anchor').map(item=>[item.id,item.timeSec]),
  [['middle',1],['last',2]],'Moving the anchor cannot shift any other key');
assert.equal(continuation.session.startTimeSec,3,'Moving the anchor cannot shift the clip boundary');
assert.equal(continuation.commits.length,0);
assert.ok(continuation.render().save());
const continued=continuation.state.timeline.clips[0];
assert.equal(continued.poseContinuation.anchorKeyId,'anchor');
assert.equal(context.__localBoneClipData(continued).poseContinuation.anchorKeyId,'anchor',
  'Stage normalization must retain a continuation whose anchor moved away from zero');
await continuation.render().begin('person','saved',4.5);
assert.equal(continuation.session.boneKeys.find(item=>item.id==='anchor').timeSec,1.5,
  'Reopening the editor cannot silently move the anchor back to zero');
assert.equal(continuation.session.poseContinuation.anchorKeyId,'anchor');

const elements=value=>Array.isArray(value)?value.flatMap(elements):!value||typeof value!=='object'?[]:
  [value,...elements(value.props?.children)];
function markerFixture({pixelsPerFrame=6,continuation=false}={}){
  const hooks=[],moves=[],edits=[],captures=new Set();
  let cursor=0,tree;
  const target={setPointerCapture:id=>captures.add(id),releasePointerCapture:id=>captures.delete(id),
    hasPointerCapture:id=>captures.has(id),focus:()=>{}};
  const value={...clip,offsetTimeSec:0,speed:1,boneTiming:{offsetTimeSec:0,speed:1},boneKeyframes:keys,
    ...(continuation?{poseContinuation:{anchorKeyId:'anchor',transitionFrames:8}}:{})};
  const render=()=>{
    cursor=0;
    context.n={useRef:initial=>hooks[cursor++]??(hooks[cursor-1]={current:initial}),
      useState:initial=>{const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};
        return[hooks[index].value,next=>{hooks[index].value=typeof next==='function'?next(hooks[index].value):next}]}};
    tree=context.__LocalBoneMarkers({clip:value,session:null,fps:30,pixelsPerFrame,
      onMove:(...args)=>moves.push(args),onEdit:time=>edits.push(time),onDelete:()=>{}});
    return tree;
  };
  const button=id=>elements(tree).find(element=>element.props['data-bone-key-id']===id);
  const event=(x,type='pointermove')=>({type,clientX:x,clientY:0,pointerId:7,isPrimary:true,button:0,
    currentTarget:target,target,defaultPrevented:false,stopped:false,
    preventDefault(){this.defaultPrevented=true},stopPropagation(){this.stopped=true}});
  render();
  return{render,button,event,moves,edits,captures};
}

for(const pixelsPerFrame of [2,10]){
  const item=markerFixture({pixelsPerFrame}),down=item.event(100,'pointerdown');
  item.button('middle').props.onPointerDown(down);
  assert.ok(down.stopped,'A marker gesture cannot trigger whole-clip dragging');
  assert.ok(item.captures.has(7),'Pointer capture retains the marker gesture outside its tiny button');
  item.button('middle').props.onPointerMove(item.event(100+15*pixelsPerFrame));item.render();
  assert.match(item.button('middle').props.style.left,/50%/,'The preview uses actual timeline scale at any zoom');
  assert.equal(item.moves.length,0,'Pointer movement previews without writing repeated history entries');
  item.button('middle').props.onPointerUp(item.event(100+15*pixelsPerFrame,'pointerup'));
  assert.equal(item.moves.length,1,'Releasing commits exactly once');
  assert.deepEqual(item.moves[0],['middle',1.5]);
  item.render();item.button('middle').props.onClick(item.event(100+15*pixelsPerFrame,'click'));
  assert.deepEqual(item.edits,[],'The synthetic click after dragging cannot enter the pose editor');
}
const cancel=markerFixture();
cancel.button('middle').props.onPointerDown(cancel.event(100,'pointerdown'));
cancel.button('middle').props.onPointerMove(cancel.event(190));cancel.render();
cancel.button('middle').props.onPointerCancel(cancel.event(190,'pointercancel'));cancel.render();
assert.deepEqual(cancel.moves,[],'Pointer cancellation cannot persist a preview');
assert.match(cancel.button('middle').props.style.left,/33\.333/,'Cancellation restores the original marker position');
const lostCapture=markerFixture();
lostCapture.button('middle').props.onPointerDown(lostCapture.event(100,'pointerdown'));
lostCapture.button('middle').props.onPointerMove(lostCapture.event(190));lostCapture.render();
lostCapture.button('middle').props.onLostPointerCapture(lostCapture.event(190,'lostpointercapture'));lostCapture.render();
assert.deepEqual(lostCapture.moves,[],'Losing pointer capture cancels the gesture instead of accepting the preview');
const collision=markerFixture();
collision.button('middle').props.onPointerDown(collision.event(100,'pointerdown'));
collision.button('middle').props.onPointerMove(collision.event(280));collision.render();
assert.match(collision.button('middle').props.style.left,/33\.333/,'Occupied-frame preview keeps the original marker in place');
collision.button('middle').props.onPointerUp(collision.event(280,'pointerup'));
assert.deepEqual(collision.moves,[],'A marker dropped on another key cannot request a destructive overwrite');
const anchorDrag=markerFixture({continuation:true});
anchorDrag.button('anchor').props.onPointerDown(anchorDrag.event(100,'pointerdown'));
anchorDrag.button('anchor').props.onPointerMove(anchorDrag.event(190));anchorDrag.render();
assert.match(anchorDrag.button('anchor').props.style.left,/16\.666/,'The continuation anchor has the same independent drag preview');
anchorDrag.button('anchor').props.onPointerUp(anchorDrag.event(190,'pointerup'));
assert.deepEqual(anchorDrag.moves,[['anchor',0.5]],'The first key drag only passes its own stable ID');
const click=markerFixture();
click.button('middle').props.onPointerDown(click.event(100,'pointerdown'));
click.button('middle').props.onPointerUp(click.event(100,'pointerup'));
click.render();click.button('middle').props.onClick(click.event(100,'click'));
assert.deepEqual(click.moves,[],'An ordinary click cannot produce a timing commit');
assert.deepEqual(click.edits,[1],'An ordinary click still edits the selected key');
console.log('Skeletal marker dragging passed: frame snapping, collision handling, independently movable continuation anchors, retimed clips, transactional drafts, pointer preview/commit/cancel, zoom geometry, and click suppression.');
