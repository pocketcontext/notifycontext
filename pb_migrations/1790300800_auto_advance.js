migrate(app=>{
  const collection=app.findCollectionByNameOrId('notification_preferences');
  collection.fields.add(new SelectField({name:'auto_advance',values:['stay','next','previous','list'],maxSelect:1,required:true}));
  app.save(collection);
  // Keep existing accounts on the current behavior without changing alert pauses or revisions.
  for(const record of app.findRecordsByFilter(collection.id,'auto_advance = ""','',0,0)){
    record.set('auto_advance','stay');app.save(record);
  }
},app=>{
  const collection=app.findCollectionByNameOrId('notification_preferences');
  collection.fields.removeByName('auto_advance');app.save(collection);
});
