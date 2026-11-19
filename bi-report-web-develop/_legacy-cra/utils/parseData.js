import PostalMime from 'postal-mime';

export const parseEmlData = async (data) => {
  const parser = new PostalMime();
  const email = await parser.parse(data);
  return email && email.text ? email.text : '';
};
