export default (sequelize, DataTypes) => {
    const suggestion = sequelize.define('suggestion', {
      text: DataTypes.STRING, // Suggestion has only text
  
      
    });
  
    return suggestion;
  }; 