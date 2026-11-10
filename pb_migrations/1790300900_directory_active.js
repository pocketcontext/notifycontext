// The directory keeps every account so history keeps its names; `active` marks who can receive.
migrate(app=>{
  const collection=app.findCollectionByNameOrId('user_directory');
  collection.fields.add(new BoolField({name:'active'}));
  app.save(collection);
  for(const user of app.findAllRecords('users')){
    const rows=app.findRecordsByFilter(collection.id,'id = {:id}','',1,0,{id:user.id});
    if(!rows.length)continue;
    const active=user.getBool('verified') && !user.getBool('disabled');
    if(rows[0].getBool('active')===active)continue;
    rows[0].set('active',active);app.save(rows[0]);
  }
},app=>{
  const collection=app.findCollectionByNameOrId('user_directory');
  collection.fields.removeByName('active');app.save(collection);
});
